const NON_RESOURCE_SCHEMES = new Set(['http:', 'https:', 'file:', 'data:', 'blob:', 'javascript:', 'vbscript:', 'mailto:', 'tel:', 'sms:', 'about:', 'devtools:', 'moss-image:', 'moss-media:', 'moss-remote-workspace:']);
// Custom links resolve through installed App providers, never an OS URL handler.
export function isAppResourceUri(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  try { const url = new URL(value); return Boolean(url.hostname) && !NON_RESOURCE_SCHEMES.has(url.protocol); }
  catch { return false; }
}
