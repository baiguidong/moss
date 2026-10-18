// Resolve at use time: bootstrap installs the Web client, while static renderer
// tests have no browser window.
export function isWebUI(): boolean {
  return typeof window !== 'undefined' && Boolean(window.mossWeb);
}

export function supportsHostFeature(feature: keyof import('../../shared/host-capabilities.mjs').HostCapabilities['features']): boolean {
  if (!isWebUI()) return true;
  return window.mossWeb?.capabilities?.features[feature] === true;
}
