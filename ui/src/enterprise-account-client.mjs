import {
  normalizeRemoteDirectCredentialMode,
} from './desktop-settings.mjs';

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
  const nestedApiKey = ownStringField(enterpriseAccount, 'apiKey');
  const nestedWorkspace = ownStringField(enterpriseAccount, 'workspace');
  return {
    serverUrl:
      nestedServerUrl ??
      stringField(settings, 'enterpriseAccountServerUrl') ??
      '',
    credentialMode: normalizeRemoteDirectCredentialMode(
      enterpriseAccount.credentialMode ?? settings?.enterpriseAccountCredentialMode,
    ),
    userEmail:
      nestedUserEmail ??
      stringField(settings, 'enterpriseAccountUserEmail') ??
      '',
    userPassword:
      nestedUserPassword ??
      (typeof settings?.enterpriseAccountUserPassword === 'string'
        ? settings.enterpriseAccountUserPassword
        : ''),
    apiKey:
      nestedApiKey ??
      stringField(settings, 'enterpriseAccountApiKey') ??
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

function decodeAccessTokenIdentity(authToken) {
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

export async function requestEnterpriseAuthentication({
  authCenterUrl,
  credentialMode,
  loginIdentifier,
  password,
  apiKey,
  signal,
  fetchImpl = enterpriseAccountFetch,
  redirect,
}) {
  const normalizedAuthCenterUrl = typeof authCenterUrl === 'string'
    ? authCenterUrl.trim().replace(/\/+$/, '')
    : '';
  if (!normalizedAuthCenterUrl) {
    throw new Error('Moss server URL is required.');
  }

  let payload;
  if (credentialMode === 'api-key') {
    const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!normalizedApiKey) {
      throw new Error('API Key is required for moss server API-key login.');
    }
    payload = {
      grant_type: 'api_key',
      api_key: normalizedApiKey,
    };
  } else {
    const normalizedLoginIdentifier = typeof loginIdentifier === 'string'
      ? loginIdentifier.trim()
      : '';
    if (!normalizedLoginIdentifier) {
      throw new Error('Username or email is required for moss server password login.');
    }
    if (typeof password !== 'string' || !password) {
      throw new Error('User password is required for moss server password login.');
    }
    payload = {
      grant_type: 'password',
      ...(normalizedLoginIdentifier.includes('@')
        ? { email: normalizedLoginIdentifier }
        : { username: normalizedLoginIdentifier }),
      password,
    };
  }

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
    throw new Error('Remote Direct server URL is required.');
  }

  const parsed = parseRemoteDirectServerInput(raw);
  const authentication = await requestEnterpriseAuthentication({
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    redirect: options.redirect,
    authCenterUrl: parsed.authCenterUrl,
    credentialMode: enterpriseAccount.credentialMode,
    loginIdentifier: enterpriseAccount.userEmail,
    password: enterpriseAccount.userPassword,
    apiKey: enterpriseAccount.apiKey,
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

export async function fetchRemoteUsageOverview({ serverUrl, authToken, signal = AbortSignal.timeout(20_000) }) {
  const response = await enterpriseAccountFetch(`${serverUrl}/api/v1/usage`, {
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
export function createEnterpriseAccountClient({ getSettings }) {
  const currentSettings = (settings) => settings ?? getSettings();
  return {
    getDesktopAgentMode: (settings) => getDesktopAgentMode(currentSettings(settings)),
    isRemoteDirectModeEnabled: (settings) => isRemoteDirectModeEnabled(currentSettings(settings)),
    getEnterpriseAccountSettings: (settings) => getEnterpriseAccountSettings(currentSettings(settings)),
    getRemoteDirectWorkspace: (settings) => getRemoteDirectWorkspace(currentSettings(settings)),
    isRemoteDirectSessionNotFoundError,
    parseRemoteDirectServerInput,
    requestEnterpriseAuthentication,
    requestEnterpriseAccessToken,
    resolveEnterpriseAccountConnection: (settings, options) => resolveEnterpriseAccountConnection(currentSettings(settings), options),
    parseRemoteDirectError,
    getCloudUsageOverview: async (settings) => {
      const resolvedSettings = currentSettings(settings);
      const remote = getEnterpriseAccountSettings(resolvedSettings);
      const hasCredentials = remote.credentialMode === 'api-key'
        ? Boolean(remote.apiKey)
        : Boolean(remote.userEmail && remote.userPassword);
      if (!resolvedSettings?.enterpriseEnabled || !remote.serverUrl || !hasCredentials) return null;
      const signal = AbortSignal.timeout(20_000);
      const connection = await resolveEnterpriseAccountConnection(resolvedSettings, { signal });
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
