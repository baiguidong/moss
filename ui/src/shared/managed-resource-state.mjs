import fs from 'node:fs';
import path from 'node:path';

export function readManagedControlState(home) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(home, 'managed-resource-control.json'), 'utf8'));
    if (value.enabled === false) return value;
    return { ...value, resources: (value.resources || []).filter(item => typeof item.source === 'string') };
  } catch (error) {
    return error.code === 'ENOENT' ? null : { enabled: true, resources: [] };
  }
}

export function readManagedCatalog(home) {
  const state = readManagedControlState(home);
  return state?.enabled === false ? null : state;
}
