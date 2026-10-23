import type { StoredApp } from '../types';

export async function authorizeAppConnector({ app, createSession, api }: {
  app: StoredApp;
  createSession: (title: string) => Promise<string>;
  api: Pick<Window['agentDesktop'], 'connectorApp' | 'getSession' | 'setSessionConnectors' | 'setConnectorAuthStatus'>;
}) {
  const connectorId = app.connectorApp?.id;
  if (!connectorId) throw new Error('此 App 未提供连接能力');
  const connectorName = app.displayName || app.title || app.name;
  const { result } = await runMcpConnectorAuthorization({
    connectorId,
    createSession: () => createSession(`${connectorName}授权`),
    authenticate: sessionId => api.connectorApp({ appId: app.id || app.name, action: 'auth', sessionId }),
    attachConnector: (sessionId, id) => attachAuthorizedConnectorToSession({
      sessionId, connectorId: id, getSession: api.getSession, setSessionConnectors: api.setSessionConnectors,
    }),
    onSessionCreated: sessionId => api.setConnectorAuthStatus({ sessionId, connectorId, connectorName, status: 'pending' }),
    onAuthenticated: sessionId => api.setConnectorAuthStatus({ sessionId, connectorId, connectorName, status: 'success' }),
    onFailed: (sessionId, _id, error) => api.setConnectorAuthStatus({
      sessionId, connectorId, connectorName, status: 'failed', message: error instanceof Error ? error.message : String(error),
    }),
  });
  return result;
}

type SessionWithConnectors = {
  connectorIds?: string[];
};

type SetSessionConnectorsResult<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

export async function attachAuthorizedConnectorToSession<T extends SessionWithConnectors>({
  sessionId,
  connectorId,
  getSession,
  setSessionConnectors,
}: {
  sessionId: string;
  connectorId: string;
  getSession: (payload: { sessionId: string }) => Promise<T>;
  setSessionConnectors: (payload: {
    sessionId: string;
    connectorIds: string[];
  }) => Promise<SetSessionConnectorsResult<T>>;
}): Promise<T> {
  const session = await getSession({ sessionId });
  const connectorIds = Array.from(new Set([...(session.connectorIds ?? []), connectorId]));
  const result = await setSessionConnectors({ sessionId, connectorIds });
  if (!result?.success || !result.data) {
    throw new Error(result?.error || '授权已完成，但连接器加入会话失败');
  }
  return result.data;
}

export async function runMcpConnectorAuthorization<T>({
  connectorId,
  createSession,
  authenticate,
  attachConnector,
  onSessionCreated,
  onAuthenticated,
  onFailed,
}: {
  connectorId: string;
  createSession: () => Promise<string>;
  authenticate: (sessionId: string) => Promise<T>;
  attachConnector: (sessionId: string, connectorId: string) => Promise<unknown>;
  onSessionCreated?: (sessionId: string) => Promise<unknown>;
  onAuthenticated?: (sessionId: string, connectorId: string) => Promise<unknown>;
  onFailed?: (sessionId: string, connectorId: string, error: unknown) => Promise<unknown>;
}): Promise<{ sessionId: string; result: T }> {
  // The bootstrap session must not include the pending connector: session
  // creation accepts authorized connectors only, while this flow creates the
  // authorization needed to satisfy that invariant.
  const sessionId = await createSession();
  try {
    await onSessionCreated?.(sessionId);
    const result = await authenticate(sessionId);
    if ((result as { auth?: { status?: string } })?.auth?.status === 'authenticated') {
      await attachConnector(sessionId, connectorId);
      await onAuthenticated?.(sessionId, connectorId);
    }
    return { sessionId, result };
  } catch (error) {
    try {
      await onFailed?.(sessionId, connectorId, error);
    } catch {
      // A notification failure must not replace the original OAuth error.
    }
    throw error;
  }
}
