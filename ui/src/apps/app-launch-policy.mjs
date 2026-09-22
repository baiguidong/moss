export function requireEnabledAppForLaunch({ runtime, appId, displayName } = {}) {
  const normalizedAppId = String(appId || '').trim();
  const installation = runtime?.installations?.get?.(normalizedAppId);
  if (!installation?.enabled) {
    const label = String(displayName || normalizedAppId || 'App').trim();
    throw new Error(`“${label}”未启用，请先启用后再打开。`);
  }
  return installation;
}
