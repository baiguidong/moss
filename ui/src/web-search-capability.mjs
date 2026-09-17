import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WEB_SEARCH_MODES = Object.freeze([
  'auto',
  'tavily',
  'brave',
  'native',
  'disabled',
]);

export const WEB_SEARCH_CAPABILITY_STATUSES = Object.freeze([
  'supported',
  'compatible',
  'unsupported',
  'unknown',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWebSearchMode(value) {
  return WEB_SEARCH_MODES.includes(value) ? value : 'auto';
}

export function normalizeWebSearchSettings(value, existing = {}) {
  const source = isObject(value) ? value : {};
  const previous = isObject(existing) ? existing : {};
  return {
    mode: normalizeWebSearchMode(source.mode ?? previous.mode),
    tavilyApiKey: Object.prototype.hasOwnProperty.call(source, 'tavilyApiKey')
      ? normalizeString(source.tavilyApiKey)
      : normalizeString(previous.tavilyApiKey),
    braveApiKey: Object.prototype.hasOwnProperty.call(source, 'braveApiKey')
      ? normalizeString(source.braveApiKey)
      : normalizeString(previous.braveApiKey),
  };
}

export function getWebSearchCapabilityFingerprint({
  url,
  model,
  apiKey,
  protocol = 'anthropic-messages',
}) {
  return createHash('sha256')
    .update([
      normalizeString(url) || 'https://api.anthropic.com',
      normalizeString(protocol) || 'anthropic-messages',
      normalizeString(model),
      createHash('sha256').update(normalizeString(apiKey)).digest('hex'),
    ].join('\0'))
    .digest('hex');
}

export function resolveWebSearchProviders(settings, nativeCapability) {
  const normalized = normalizeWebSearchSettings(settings);
  const nativeAvailable = nativeCapability?.status === 'supported'
    || nativeCapability?.status === 'compatible';

  if (normalized.mode === 'disabled') return [];
  if (normalized.mode === 'tavily') return normalized.tavilyApiKey ? ['tavily'] : [];
  if (normalized.mode === 'brave') return normalized.braveApiKey ? ['brave'] : [];
  if (normalized.mode === 'native') return nativeAvailable ? ['native'] : [];

  return [
    ...(normalized.tavilyApiKey ? ['tavily'] : []),
    ...(normalized.braveApiKey ? ['brave'] : []),
    ...(nativeAvailable ? ['native'] : []),
  ];
}

function normalizeCapabilityRecord(value) {
  if (!isObject(value) || !WEB_SEARCH_CAPABILITY_STATUSES.includes(value.status)) return null;
  return {
    status: value.status,
    format: value.format === 'structured' || value.format === 'compatible-text'
      ? value.format
      : null,
    checkedAt: Number.isFinite(value.checkedAt) ? value.checkedAt : Date.now(),
    reasonCode: normalizeString(value.reasonCode) || null,
  };
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}

export function createWebSearchCapabilityStore({ storagePath, log = () => {} }) {
  let records = {};
  try {
    if (fs.existsSync(storagePath)) {
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
      if (isObject(parsed?.records)) records = parsed.records;
    }
  } catch (error) {
    log('warn', 'web-search', 'Unable to load WebSearch capability cache', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const persist = () => {
    writePrivateJson(storagePath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records,
    });
  };

  return {
    get(fingerprint) {
      return normalizeCapabilityRecord(records[fingerprint]);
    },
    set(fingerprint, result) {
      const normalized = normalizeCapabilityRecord({
        ...result,
        checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : Date.now(),
      });
      if (!normalized) throw new Error('Invalid WebSearch capability result.');
      records = { ...records, [fingerprint]: normalized };
      persist();
      return normalized;
    },
    delete(fingerprint) {
      if (!Object.prototype.hasOwnProperty.call(records, fingerprint)) return false;
      const next = { ...records };
      delete next[fingerprint];
      records = next;
      persist();
      return true;
    },
  };
}

export function toPublicWebSearchSettings(settings, nativeCapability, detecting = false) {
  const normalized = normalizeWebSearchSettings(settings);
  const capability = detecting
    ? { status: 'detecting', format: null, checkedAt: null, reasonCode: null }
    : nativeCapability || { status: 'unknown', format: null, checkedAt: null, reasonCode: 'not-detected' };
  const providers = resolveWebSearchProviders(normalized, capability);
  return {
    mode: normalized.mode,
    tavilyApiKey: '',
    braveApiKey: '',
    tavilyConfigured: Boolean(normalized.tavilyApiKey),
    braveConfigured: Boolean(normalized.braveApiKey),
    nativeCapability: capability,
    activeProvider: providers[0] || null,
  };
}
