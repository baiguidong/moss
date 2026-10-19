const STORAGE_KEY = 'ui.installedAppCount.v1';

export function readInstalledAppCount(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : null;
  } catch {
    return null;
  }
}

export function writeInstalledAppCount(storage: Pick<Storage, 'setItem'>, count: number): void {
  try {
    storage.setItem(STORAGE_KEY, String(count));
  } catch {
    // Storage may be unavailable; the live App list still works.
  }
}
