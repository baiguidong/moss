export const USER_AVATAR_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif',
];
export const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;

export function normalizeUserAvatar(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_USER_AVATAR_BYTES / 3) * 4 + 64) return '';
  const separator = value.indexOf(',');
  if (separator < 0) return '';
  const header = value.slice(0, separator);
  if (!USER_AVATAR_MIME_TYPES.some(type => header === `data:${type};base64`)) return '';
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(separator + 1)) ? value : '';
}
