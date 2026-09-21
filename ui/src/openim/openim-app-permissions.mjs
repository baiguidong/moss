export const OPENIM_APP_ID = 'moss.openim';

export function isAuthorizedOpenIMAppState({
  state,
  runtime,
  installation,
  permission = 'openim:client',
  appId = OPENIM_APP_ID,
} = {}) {
  return Boolean(
    state?.id === appId
    && state?.runtime === runtime
    && state?.source?.mode !== 'preview'
    && installation?.enabled
    && installation.grants?.includes(permission)
  );
}

export function isAllowedOpenIMMediaPermission({
  state,
  runtime,
  installation,
  permission,
  mediaTypes,
  appId = OPENIM_APP_ID,
} = {}) {
  if (permission !== 'media') return false;
  const requestedMediaTypes = Array.isArray(mediaTypes) ? mediaTypes : [];
  if (requestedMediaTypes.some((type) => !['audio', 'video'].includes(type))) return false;
  return isAuthorizedOpenIMAppState({
    state,
    runtime,
    installation,
    permission: 'openim:media',
    appId,
  });
}
