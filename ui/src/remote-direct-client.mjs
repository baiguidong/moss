import {
  normalizeRemoteDirectCredentialMode,
  normalizeRemoteDirectProfileMode,
} from './desktop-settings.mjs';

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
  return settings?.agentMode === 'remote-direct' ? 'remote-direct' : 'local';
}

export function isRemoteDirectModeEnabled(settings) {
  return getDesktopAgentMode(settings) === 'remote-direct';
}

export function getRemoteDirectSettings(settings) {
  const remoteDirect = objectField(settings, 'remoteDirect');
  const nestedServerUrl = ownStringField(remoteDirect, 'serverUrl');
  const nestedUserEmail = ownStringField(remoteDirect, 'userEmail');
  const nestedUserPassword = ownRawStringField(remoteDirect, 'userPassword');
  const nestedApiKey = ownStringField(remoteDirect, 'apiKey');
  const nestedWorkspace = ownStringField(remoteDirect, 'workspace');
  const nestedProfileMode = ownStringField(remoteDirect, 'profileMode');
  return {
    serverUrl:
      nestedServerUrl ??
      stringField(settings, 'remoteDirectServerUrl') ??
      '',
    credentialMode: normalizeRemoteDirectCredentialMode(
      remoteDirect.credentialMode ?? settings?.remoteDirectCredentialMode,
    ),
    userEmail:
      nestedUserEmail ??
      stringField(settings, 'remoteDirectUserEmail') ??
      '',
    userPassword:
      nestedUserPassword ??
      (typeof settings?.remoteDirectUserPassword === 'string'
        ? settings.remoteDirectUserPassword
        : ''),
    apiKey:
      nestedApiKey ??
      stringField(settings, 'remoteDirectApiKey') ??
      '',
    workspace:
      nestedWorkspace ??
      stringField(settings, 'remoteDirectWorkspace') ??
      '',
    profileMode: normalizeRemoteDirectProfileMode(
      nestedProfileMode ?? settings?.remoteDirectProfileMode,
    ),
  };
}

export function getRemoteDirectWorkspace(settings) {
  const value = getRemoteDirectSettings(settings).workspace;
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

export async function requestRemoteDirectAccessToken({
  authCenterUrl,
  credentialMode,
  loginIdentifier,
  password,
  apiKey,
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
    response = await fetch(`${normalizedAuthCenterUrl}/api/v1/auth/token`, {
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
    throw new Error(`Failed to get access token from moss server: ${message}`);
  }

  const data = await response.json();
  if (!data?.access_token) {
    throw new Error('Moss server response missing access_token.');
  }
  return data.access_token;
}

export async function resolveRemoteDirectConnection(settings) {
  const remoteDirect = getRemoteDirectSettings(settings);
  const raw = remoteDirect.serverUrl;

  if (!raw) {
    throw new Error('Remote Direct server URL is required.');
  }

  const parsed = parseRemoteDirectServerInput(raw);
  const authToken = await requestRemoteDirectAccessToken({
    authCenterUrl: parsed.authCenterUrl,
    credentialMode: remoteDirect.credentialMode,
    loginIdentifier: remoteDirect.userEmail,
    password: remoteDirect.userPassword,
    apiKey: remoteDirect.apiKey,
  });

  return {
    serverUrl: parsed.serverUrl,
    authToken,
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

async function requestRemoteFeishuAdapter(settings, path, { method = 'GET', body } = {}) {
  const { serverUrl, authToken } = await resolveRemoteDirectConnection(settings);
  let response;
  try {
    response = await fetch(`${serverUrl}/api/v1/adapters/feishu/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to the Moss Server Feishu runtime: ${message}`);
  }
  if (!response.ok) {
    throw new Error(await parseRemoteDirectError('Moss Server Feishu runtime request failed', response));
  }
  return response.json();
}

export function fetchRemoteFeishuAdapterStatus(settings) {
  return requestRemoteFeishuAdapter(settings, 'status');
}

export function startRemoteFeishuAdapter(settings, config) {
  return requestRemoteFeishuAdapter(settings, 'start', {
    method: 'POST',
    body: { config },
  });
}

export function stopRemoteFeishuAdapter(settings) {
  return requestRemoteFeishuAdapter(settings, 'stop', { method: 'POST' });
}

async function requestRemoteApps(settings, path = '', { method = 'GET', body } = {}) {
  const { serverUrl, authToken } = await resolveRemoteDirectConnection(settings);
  let response;
  try {
    response = await fetch(`${serverUrl}/api/v1/apps${path}`, {
      method,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new Error(`Failed to connect to the Moss Server App Runtime: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(await parseRemoteDirectError('Moss Server App Runtime request failed', response));
  return response.json();
}

export async function fetchRemoteApps(settings) {
  const result = await requestRemoteApps(settings);
  return Array.isArray(result?.apps) ? result.apps : [];
}

export async function fetchRemoteAppAvailability(settings, packages) {
  const result = await requestRemoteApps(settings, '/availability', {
    method: 'POST',
    body: { packages },
  });
  return Array.isArray(result?.packages) ? result.packages : [];
}

export function installRemoteApp(settings, appId, version) {
  return requestRemoteApps(settings, '/install', { method: 'POST', body: { appId, version, activate: true } });
}

export function updateRemoteApp(settings, appId, patch) {
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}`, { method: 'PATCH', body: patch });
}

export function uninstallRemoteApp(settings, appId, options = {}) {
  const query = new URLSearchParams({
    delete_data: options.deleteData ? 'true' : 'false',
    delete_credentials: options.deleteCredentials ? 'true' : 'false',
  });
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}?${query}`, { method: 'DELETE' });
}

export function createRemoteAppInstance(settings, appId, input) {
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}/instances`, { method: 'POST', body: input });
}

export function updateRemoteAppInstance(settings, appId, instanceId, patch) {
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}/instances/${encodeURIComponent(instanceId)}`, { method: 'PATCH', body: patch });
}

export function removeRemoteAppInstance(settings, appId, instanceId, options = {}) {
  const query = new URLSearchParams({
    delete_data: options.deleteData ? 'true' : 'false',
    delete_credentials: options.deleteCredentials ? 'true' : 'false',
  });
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}/instances/${encodeURIComponent(instanceId)}?${query}`, { method: 'DELETE' });
}

export function restartRemoteAppInstance(settings, appId, instanceId) {
  return requestRemoteApps(settings, `/${encodeURIComponent(appId)}/instances/${encodeURIComponent(instanceId)}/restart`, { method: 'POST' });
}

export async function fetchRemoteAppLogs(settings, appId, instanceId, limit = 500) {
  const result = await requestRemoteApps(settings, `/${encodeURIComponent(appId)}/instances/${encodeURIComponent(instanceId)}/logs?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(result?.logs) ? result.logs : [];
}

export async function fetchRemoteDirectSessions({ serverUrl, authToken }) {
  let response;
  try {
    response = await fetch(`${serverUrl}/api/v1/sessions`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError('Failed to list remote sessions', response),
    );
  }

  const data = await response.json();
  return {
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
  };
}

export async function fetchRemoteDirectSessionInfo({ serverUrl, authToken, sessionId }) {
  let response;
  try {
    response = await fetch(
      `${serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError(`Failed to query remote session ${sessionId}`, response),
    );
  }

  return response.json();
}

export async function fetchRemoteDirectSessionContext({ serverUrl, authToken, sessionId }) {
  let response;
  try {
    response = await fetch(
      `${serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/context`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError(`Failed to query remote session context ${sessionId}`, response),
    );
  }

  return response.json();
}

export async function fetchRemoteDirectWorkspaceDir({ serverUrl, authToken, sessionId, dirPath }) {
  const endpoint = new URL(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/workspace/list`,
    serverUrl,
  );
  if (typeof dirPath === 'string' && dirPath.trim()) {
    endpoint.searchParams.set('dir', dirPath);
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError('Failed to list remote workspace directory', response),
    );
  }

  return response.json();
}

export async function fetchRemoteDirectWorkspaceFile({ serverUrl, authToken, sessionId, filePath }) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Remote workspace file path is required.');
  }
  const endpoint = new URL(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/workspace/read`,
    serverUrl,
  );
  endpoint.searchParams.set('file', filePath);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError('Failed to read remote workspace file', response),
    );
  }

  return response.json();
}

export async function resumeRemoteDirectSession({ serverUrl, authToken, sessionId }) {
  let response;
  try {
    response = await fetch(
      `${serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/resume`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError(`Failed to resume remote session ${sessionId}`, response),
    );
  }

  const data = await response.json();
  const wsUrl = typeof data?.ws_url === 'string' ? data.ws_url : '';
  const resumedSessionId = typeof data?.session?.sessionId === 'string'
    ? data.session.sessionId
    : sessionId;
  if (!wsUrl) {
    throw new Error(`Remote session ${sessionId} resume response missing ws_url.`);
  }

  return {
    config: {
      serverUrl,
      sessionId: resumedSessionId,
      wsUrl,
      authToken,
    },
    workDir: typeof data?.session?.workDir === 'string' ? data.session.workDir : undefined,
  };
}

export async function forkRemoteDirectSession({ serverUrl, authToken, sessionId, title, dangerouslySkipPermissions = false }) {
  let response;
  try {
    response = await fetch(
      `${serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/fork`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title,
          dangerously_skip_permissions: dangerouslySkipPermissions,
        }),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to remote session server: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      await parseRemoteDirectError(`Failed to fork remote session ${sessionId}`, response),
    );
  }

  return response.json();
}

export function createRemoteDirectClient({ getSettings }) {
  const currentSettings = (settings) => settings ?? getSettings();
  return {
    getDesktopAgentMode: (settings) => getDesktopAgentMode(currentSettings(settings)),
    isRemoteDirectModeEnabled: (settings) => isRemoteDirectModeEnabled(currentSettings(settings)),
    getRemoteDirectSettings: (settings) => getRemoteDirectSettings(currentSettings(settings)),
    getRemoteDirectWorkspace: (settings) => getRemoteDirectWorkspace(currentSettings(settings)),
    isRemoteDirectSessionNotFoundError,
    parseRemoteDirectServerInput,
    requestRemoteDirectAccessToken,
    resolveRemoteDirectConnection: (settings) => resolveRemoteDirectConnection(currentSettings(settings)),
    parseRemoteDirectError,
    fetchRemoteFeishuAdapterStatus: (settings) => fetchRemoteFeishuAdapterStatus(currentSettings(settings)),
    startRemoteFeishuAdapter: (config, settings) => startRemoteFeishuAdapter(currentSettings(settings), config),
    stopRemoteFeishuAdapter: (settings) => stopRemoteFeishuAdapter(currentSettings(settings)),
    fetchRemoteApps: (settings) => fetchRemoteApps(currentSettings(settings)),
    fetchRemoteAppAvailability: (packages, settings) => fetchRemoteAppAvailability(currentSettings(settings), packages),
    installRemoteApp: (appId, version, settings) => installRemoteApp(currentSettings(settings), appId, version),
    updateRemoteApp: (appId, patch, settings) => updateRemoteApp(currentSettings(settings), appId, patch),
    uninstallRemoteApp: (appId, options, settings) => uninstallRemoteApp(currentSettings(settings), appId, options),
    createRemoteAppInstance: (appId, input, settings) => createRemoteAppInstance(currentSettings(settings), appId, input),
    updateRemoteAppInstance: (appId, instanceId, patch, settings) => updateRemoteAppInstance(currentSettings(settings), appId, instanceId, patch),
    removeRemoteAppInstance: (appId, instanceId, options, settings) => removeRemoteAppInstance(currentSettings(settings), appId, instanceId, options),
    restartRemoteAppInstance: (appId, instanceId, settings) => restartRemoteAppInstance(currentSettings(settings), appId, instanceId),
    fetchRemoteAppLogs: (appId, instanceId, limit, settings) => fetchRemoteAppLogs(currentSettings(settings), appId, instanceId, limit),
    fetchRemoteDirectSessions,
    fetchRemoteDirectSessionInfo,
    fetchRemoteDirectSessionContext,
    forkRemoteDirectSession,
    fetchRemoteDirectWorkspaceDir,
    fetchRemoteDirectWorkspaceFile,
    resumeRemoteDirectSession,
  };
}
