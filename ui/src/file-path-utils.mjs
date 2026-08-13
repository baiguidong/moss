import path from 'node:path';

export function resolveUserPath(value, homeDir) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) throw new Error('File path is required');
  if (input === '~') return path.resolve(homeDir);
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.resolve(homeDir, input.slice(2));
  }
  return path.resolve(input);
}
