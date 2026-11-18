export const MAX_REMOTE_PREVIEW_DOWNLOAD_BYTES = 250 * 1024 * 1024;
export const MAX_REMOTE_WORKSPACE_UPLOAD_BYTES = 250 * 1024 * 1024;

let enterpriseAccountFetch = (...args) => globalThis.fetch(...args);

export function setEnterpriseFetchImplementation(fetchImpl) {
  enterpriseAccountFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : (...args) => globalThis.fetch(...args);
}

function objectField(source, key) {
  const value = source?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringField(source, key) {
  return typeof source?.[key] === 'string' ? source[key].trim() : undefined;
}

function ownStringField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) && typeof source?.[key] === 'string'
    ? source[key].trim()
    : undefined;
}

function ownRawStringField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) && typeof source?.[key] === 'string'
    ? source[key]
    : undefined;
}

export function getDesktopAgentMode(settings) {
  return 'local';
}

export function isRemoteDirectModeEnabled(settings) {
  return getDesktopAgentMode(settings) === 'remote-direct';
}

export function getEnterpriseAccountSettings(settings) {
  const enterpriseAccount = objectField(settings, 'enterpriseAccount');
  const nestedServerUrl = ownStringField(enterpriseAccount, 'serverUrl');
  const nestedUserEmail = ownStringField(enterpriseAccount, 'userEmail');
  const nestedUserPassword = ownRawStringField(enterpriseAccount, 'userPassword');
  const nestedAccessToken = ownStringField(enterpriseAccount, 'accessToken');
  const nestedWorkspace = ownStringField(enterpriseAccount, 'workspace');
  return {
    serverUrl:
      nestedServerUrl ??
      stringField(settings, 'enterpriseAccountServerUrl') ??
      '',
    credentialMode: 'password',
    userEmail:
      nestedUserEmail ??
      stringField(settings, 'enterpriseAccountUserEmail') ??
      '',
    userPassword:
      nestedUserPassword ??
      (typeof settings?.enterpriseAccountUserPassword === 'string'
        ? settings.enterpriseAccountUserPassword
        : ''),
    accessToken:
      nestedAccessToken ??
      stringField(settings, 'enterpriseAccountAccessToken') ??
      '',
    refreshToken:
      ownStringField(enterpriseAccount, 'refreshToken') ??
      stringField(settings, 'enterpriseAccountRefreshToken') ??
      '',
    workspace:
      nestedWorkspace ??
      stringField(settings, 'enterpriseAccountWorkspace') ??
      '',
  };
}

export function getRemoteDirectWorkspace(settings) {
  const value = getEnterpriseAccountSettings(settings).workspace;
  return value || undefined;
}

export function isRemoteDirectSessionNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b404\b/.test(message) && /\bSession not found\b/i.test(message);
}

export function parseRemoteDirectServerInput(raw) {
  if (raw.startsWith('cc+unix://')) {
    throw new Error('Unix domain socket direct-connect is not supported by the desktop client yet.');
  }

  if (raw.startsWith('cc://')) {
    const url = new URL(raw);
    if (!url.hostname || !url.port) {
      throw new Error(`Invalid direct-connect URL: ${raw}`);
    }
    if (url.searchParams.get('token')) {
      throw new Error('The desktop client no longer supports cc://...token=... URLs. Use bearer auth instead.');
    }
    const authMode = url.searchParams.get('auth_mode');
    if (authMode && authMode !== 'auth-center' && authMode !== 'local') {
      throw new Error(`Unsupported direct-connect auth mode in URL: ${authMode}`);
    }
    const serverUrl = `http://${url.hostname}:${url.port}`;
    const authCenterUrl = url.searchParams.get('auth_center') || serverUrl;
    return {
      serverUrl,
      authCenterUrl,
    };
  }

  const serverUrl = raw.replace(/\/+$/, '');
  return {
    serverUrl,
    authCenterUrl: serverUrl,
  };
}

export function decodeAccessTokenIdentity(authToken) {
  const payload = String(authToken || '').split('.')[1];
  if (!payload) return { userId: '', orgId: '' };
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return {
      userId: typeof claims?.sub === 'string' ? claims.sub.trim() : '',
      orgId: typeof claims?.org_id === 'string' ? claims.org_id.trim() : '',
    };
  } catch {
    return { userId: '', orgId: '' };
  }
}

export function isEnterpriseAccessTokenExpired(authToken, now = Date.now()) {
  try {
    const claims = JSON.parse(Buffer.from(String(authToken).split('.')[1], 'base64url').toString('utf8'));
    return typeof claims.exp === 'number' && claims.exp * 1000 <= now + 30_000;
  } catch { return false; }
}

function loginRequired() {
  return Object.assign(new Error('Moss 登录已过期，请重新登录。'), { code: 'MOSS_LOGIN_REQUIRED', status: 401 });
}

function waitForRefresh(pending, signal) {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function revokeEnterpriseAccountSession(settings, { fetchImpl = enterpriseAccountFetch, signal = AbortSignal.timeout(5_000) } = {}) {
  const remote = getEnterpriseAccountSettings(settings);
  if (!remote.serverUrl || !remote.refreshToken) return;
  const { serverUrl } = parseRemoteDirectServerInput(remote.serverUrl);
  const response = await fetchImpl(`${serverUrl}/api/v1/auth/oauth/revoke`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: remote.refreshToken }),
  });
  if (!response.ok) throw new Error(`Moss 登录会话撤销失败（${response.status}）。`);
}

async function refreshEnterpriseAuthentication({ authCenterUrl, refreshToken, signal, fetchImpl }) {
  const discoveryResponse = await fetchImpl(`${authCenterUrl}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' }, redirect: 'error', signal,
  });
  let response;
  if (discoveryResponse.status === 404) {
    response = await fetchImpl(`${authCenterUrl}/api/v1/auth/oauth/refresh`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } else {
    if (!discoveryResponse.ok) throw new Error('无法获取 Moss Server 登录配置，请稍后重试。');
    const discovery = await discoveryResponse.json();
    const endpoint = new URL(discovery.token_endpoint);
    if (endpoint.origin !== new URL(authCenterUrl).origin || endpoint.username || endpoint.password) {
      throw new Error('Moss Server 返回了无效的 token 地址。');
    }
    response = await fetchImpl(endpoint.toString(), {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: discovery.desktop_client_id || 'moss-desktop', refresh_token: refreshToken }).toString(),
    });
  }
  const data = await response.json();
  if (!response.ok) {
    if (data?.error === 'invalid_grant' || response.status === 401) throw loginRequired();
    throw new Error(`Moss 登录续期失败（${response.status}），请稍后重试。`);
  }
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) {
    throw new Error('Moss Server 续期响应缺少登录凭据。');
  }
  const identity = decodeAccessTokenIdentity(data.access_token);
  return { authToken: data.access_token, refreshToken: data.refresh_token, ...identity, userName: '', userEmail: '' };
}

export async function requestEnterpriseAuthentication({
  authCenterUrl,
  loginIdentifier,
  password,
  accessToken,
  refreshToken,
  forceRefresh = false,
  allowRefresh = true,
  signal,
  fetchImpl = enterpriseAccountFetch,
  redirect,
}) {
  const normalizedAuthCenterUrl = typeof authCenterUrl === 'string'
    ? authCenterUrl.trim().replace(/\/+$/, '')
    : '';
  if (!normalizedAuthCenterUrl) {
    throw Object.assign(new Error('请先登录 Moss 账号。'), { code: 'MOSS_LOGIN_REQUIRED' });
  }

  const normalizedAccessToken = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (normalizedAccessToken && (!allowRefresh || (!forceRefresh && !isEnterpriseAccessTokenExpired(normalizedAccessToken)))) {
    const identity = decodeAccessTokenIdentity(normalizedAccessToken);
    return {
      authToken: normalizedAccessToken,
      userId: identity.userId,
      orgId: identity.orgId,
      userName: '',
      userEmail: '',
    };
  }

  if (allowRefresh && refreshToken) {
    return refreshEnterpriseAuthentication({
      authCenterUrl: normalizedAuthCenterUrl, refreshToken,
      signal: signal || AbortSignal.timeout(20_000), fetchImpl,
    });
  }
  if (normalizedAccessToken || forceRefresh) throw loginRequired();

  const normalizedLoginIdentifier = typeof loginIdentifier === 'string'
    ? loginIdentifier.trim()
    : '';
  if (!normalizedLoginIdentifier) {
    throw Object.assign(new Error('请先登录 Moss 账号。'), { code: 'MOSS_LOGIN_REQUIRED' });
  }
  if (typeof password !== 'string' || !password) {
    throw Object.assign(new Error('请先登录 Moss 账号。'), { code: 'MOSS_LOGIN_REQUIRED' });
  }
  const payload = {
    grant_type: 'password',
    ...(normalizedLoginIdentifier.includes('@')
      ? { email: normalizedLoginIdentifier }
      : { username: normalizedLoginIdentifier }),
    password,
  };

  let response;
  try {
    response = await fetchImpl(`${normalizedAuthCenterUrl}/api/v1/auth/token`, {
      signal,
      ...(redirect ? { redirect } : {}),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to Moss Server at ${normalizedAuthCenterUrl}: ${detail}`);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch {}
    throw Object.assign(new Error(`Failed to get access token from moss server: ${message}`), { status: response.status });
  }

  const data = await response.json();
  if (!data?.access_token) {
    throw new Error('Moss server response missing access_token.');
  }
  const tokenIdentity = decodeAccessTokenIdentity(data.access_token);
  return {
    authToken: data.access_token,
    userId: typeof data?.user?.id === 'string' && data.user.id.trim()
      ? data.user.id.trim()
      : tokenIdentity.userId,
    orgId: typeof data?.organization?.id === 'string' && data.organization.id.trim()
      ? data.organization.id.trim()
      : tokenIdentity.orgId,
    userName: typeof data?.user?.name === 'string' ? data.user.name.trim() : '',
    userEmail: typeof data?.user?.email === 'string' ? data.user.email.trim() : '',
  };
}

export async function requestEnterpriseAccessToken(input) {
  return (await requestEnterpriseAuthentication(input)).authToken;
}

export async function resolveEnterpriseAccountConnection(settings, options = {}) {
  const enterpriseAccount = getEnterpriseAccountSettings(settings);
  const raw = enterpriseAccount.serverUrl;

  if (!raw) {
    throw Object.assign(new Error('请先登录 Moss 账号。'), { code: 'MOSS_LOGIN_REQUIRED' });
  }

  const parsed = parseRemoteDirectServerInput(raw);
  const authentication = await requestEnterpriseAuthentication({
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    redirect: options.redirect,
    authCenterUrl: parsed.authCenterUrl,
    loginIdentifier: enterpriseAccount.userEmail,
    password: enterpriseAccount.userPassword,
    accessToken: enterpriseAccount.accessToken,
    refreshToken: enterpriseAccount.refreshToken,
    forceRefresh: options.forceRefresh,
    allowRefresh: options.allowRefresh,
  });

  return {
    serverUrl: parsed.serverUrl,
    ...authentication,
  };
}

export async function parseRemoteDirectError(prefix, response) {
  let detail = '';
  try {
    const text = await response.text();
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
          detail = parsed.error.trim();
        } else {
          detail = text.trim();
        }
      } catch {
        detail = text.trim();
      }
    }
  } catch {}

  return detail
    ? `${prefix}: ${response.status} ${response.statusText}: ${detail}`
    : `${prefix}: ${response.status} ${response.statusText}`;
}

export async function fetchRemoteUsageOverview({ serverUrl, authToken, signal = AbortSignal.timeout(20_000), hostKind = 'cloud' }) {
  const usageUrl = new URL(`${serverUrl}/api/v1/usage`);
  if (hostKind) usageUrl.searchParams.set('host_kind', hostKind);
  const response = await enterpriseAccountFetch(usageUrl, {
    method: 'GET',
    headers: { authorization: `Bearer ${authToken}` },
    signal,
  });
  if (!response.ok) throw new Error(await parseRemoteDirectError('云端用量请求失败', response));
  const data = await response.json();
  const isCount = (value) => Number.isFinite(value) && value >= 0;
  const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const hasCounts = (row) => ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'requestCount']
    .every((field) => isCount(row?.[field]));
  if (!Number.isFinite(data?.generatedAt) || typeof data?.timezone !== 'string' || !isDay(data?.today)
    || !hasCounts(data?.totals) || !isCount(data.totals.activeDays) || !isCount(data.totals.peakTokens)
    || (data.totals.peakDay !== null && !isDay(data.totals.peakDay))
    || !Array.isArray(data?.daily) || !data.daily.every((row) => isDay(row?.day) && hasCounts(row))) {
    throw new Error('云端用量数据格式无效');
  }
  return data;
}


// Compatibility guards for archived records; no server execution transport remains.
const retired = async () => { throw new Error('服务端执行已退役，请打开我的云电脑。'); };
export const requestRemoteCron = retired;
export const requestRemoteTrace = retired;
export const fetchRemoteDirectSessions = retired;
export const fetchRemoteDirectSessionInfo = retired;
export const deleteRemoteDirectSession = retired;
export const fetchRemoteDirectSessionContext = retired;
export const fetchRemoteDirectSessionTasks = retired;
export const fetchRemoteDirectWorkspaceDir = retired;
export const fetchRemoteDirectWorkspaceFile = retired;
export const fetchRemoteDirectWorkspaceContent = retired;
export const writeRemoteDirectWorkspaceFile = retired;
export const uploadRemoteDirectWorkspaceData = retired;
export const uploadRemoteDirectWorkspaceFile = retired;
export const fetchRemoteProfileSkillStatus = retired;
export const uploadRemoteProfileSkills = retired;
export const fetchRemoteProfileMemory = retired;
export const fetchRemoteProfileMemoryFile = retired;
export const fetchRemoteSessionMemory = retired;
export const downloadRemoteDirectWorkspaceFile = retired;
export const resumeRemoteDirectSession = retired;
export const forkRemoteDirectSession = retired;
export function createEnterpriseAccountClient({ getSettings, onCredentials }) {
  const currentSettings = (settings) => settings ?? getSettings();
  const refreshes = new Map();
  const resolveConnection = async (settings, options = {}) => {
    options.signal?.throwIfAborted();
    const resolvedSettings = currentSettings(settings);
    const remote = getEnterpriseAccountSettings(resolvedSettings);
    const needsRefresh = options.allowRefresh !== false && (options.forceRefresh || !remote.accessToken || isEnterpriseAccessTokenExpired(remote.accessToken));
    if (!needsRefresh || !remote.refreshToken) return resolveEnterpriseAccountConnection(resolvedSettings, options);
    const serverUrl = parseRemoteDirectServerInput(remote.serverUrl).serverUrl;
    const key = `${serverUrl}\0${remote.refreshToken}`;
    if (refreshes.has(key)) return waitForRefresh(refreshes.get(key), options.signal);
    const pending = (async () => {
      // A canceled caller must not discard a rotated token or cancel other
      // callers. Finish and persist the rotation under its own bounded timeout.
      const { refreshToken, ...connection } = await resolveEnterpriseAccountConnection(resolvedSettings, {
        ...options, signal: AbortSignal.timeout(20_000),
      });
      const current = getEnterpriseAccountSettings(getSettings());
      if (!current.serverUrl || parseRemoteDirectServerInput(current.serverUrl).serverUrl !== serverUrl || current.refreshToken !== remote.refreshToken) throw loginRequired();
      const previousIdentity = decodeAccessTokenIdentity(remote.accessToken);
      const currentIdentity = decodeAccessTokenIdentity(current.accessToken);
      if (currentIdentity.userId !== previousIdentity.userId || currentIdentity.orgId !== previousIdentity.orgId) throw loginRequired();
      await onCredentials?.({
        serverUrl, accessToken: connection.authToken, refreshToken,
        previousAccessToken: remote.accessToken, previousRefreshToken: remote.refreshToken,
      });
      return connection;
    })().finally(() => { if (refreshes.get(key) === pending) refreshes.delete(key); });
    refreshes.set(key, pending);
    return waitForRefresh(pending, options.signal);
  };
  const fetchWithAccount = async (pathname, init = {}) => {
    if (!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('Invalid Moss Account path.');
    const connection = await resolveConnection(undefined, { signal: init.signal });
    const requestRefreshToken = getEnterpriseAccountSettings(getSettings()).refreshToken;
    const send = (current) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${current.authToken}`);
      return enterpriseAccountFetch(`${current.serverUrl}${pathname}`, { ...init, headers });
    };
    const response = await send(connection);
    if (response.status !== 401) return response;
    const remote = getEnterpriseAccountSettings(getSettings());
    if (!remote.refreshToken || parseRemoteDirectServerInput(remote.serverUrl).serverUrl !== connection.serverUrl) return response;
    const identity = decodeAccessTokenIdentity(remote.accessToken);
    if (identity.userId !== connection.userId || identity.orgId !== connection.orgId) throw loginRequired();
    await response.body?.cancel();
    const refreshed = await resolveConnection(undefined, {
      signal: init.signal,
      forceRefresh: remote.accessToken === connection.authToken && remote.refreshToken === requestRefreshToken,
    });
    return send(refreshed);
  };
  return {
    fetchWithEnterpriseAccount: fetchWithAccount,
    revokeEnterpriseAccountSession: (settings, options) => revokeEnterpriseAccountSession(currentSettings(settings), options),
    getDesktopAgentMode: (settings) => getDesktopAgentMode(currentSettings(settings)),
    isRemoteDirectModeEnabled: (settings) => isRemoteDirectModeEnabled(currentSettings(settings)),
    getEnterpriseAccountSettings: (settings) => getEnterpriseAccountSettings(currentSettings(settings)),
    getRemoteDirectWorkspace: (settings) => getRemoteDirectWorkspace(currentSettings(settings)),
    isRemoteDirectSessionNotFoundError,
    parseRemoteDirectServerInput,
    requestEnterpriseAuthentication,
    requestEnterpriseAccessToken,
    resolveEnterpriseAccountConnection: resolveConnection,
    parseRemoteDirectError,
    getCloudUsageOverview: async (settings) => {
      const resolvedSettings = currentSettings(settings);
      const remote = getEnterpriseAccountSettings(resolvedSettings);
      const hasCredentials = Boolean(remote.accessToken || remote.refreshToken || (remote.userEmail && remote.userPassword));
      if (!resolvedSettings?.enterpriseEnabled || !remote.serverUrl || !hasCredentials) return null;
      const signal = AbortSignal.timeout(20_000);
      const connection = await resolveConnection(resolvedSettings, { signal });
      return fetchRemoteUsageOverview({ ...connection, signal });
    },
    fetchRemoteDirectSessions,
    deleteRemoteDirectSession,
    fetchRemoteDirectSessionInfo,
    fetchRemoteDirectSessionContext,
    fetchRemoteDirectSessionTasks,
    forkRemoteDirectSession,
    fetchRemoteDirectWorkspaceDir,
    fetchRemoteDirectWorkspaceFile,
    fetchRemoteDirectWorkspaceContent,
    writeRemoteDirectWorkspaceFile,
    uploadRemoteDirectWorkspaceData,
    uploadRemoteDirectWorkspaceFile,
    fetchRemoteProfileSkillStatus,
    uploadRemoteProfileSkills,
    fetchRemoteProfileMemory,
    fetchRemoteProfileMemoryFile,
    fetchRemoteSessionMemory,
    resumeRemoteDirectSession,
  };
}
