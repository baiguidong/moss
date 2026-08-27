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

  const response = await fetch(`${normalizedAuthCenterUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

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
    fetchRemoteDirectSessionInfo,
    fetchRemoteDirectSessionContext,
    fetchRemoteDirectWorkspaceDir,
    fetchRemoteDirectWorkspaceFile,
    resumeRemoteDirectSession,
  };
}
