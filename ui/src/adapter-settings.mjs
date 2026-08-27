import { timingSafeEqual } from 'node:crypto';

const MASK_PREFIX = '****';

const SECRET_FIELDS = Object.freeze({
  telegram: ['botToken'],
  feishu: ['appSecret', 'encryptKey', 'verificationToken'],
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || '').trim().toUpperCase());
  const rightBuffer = Buffer.from(String(right || '').trim().toUpperCase());
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function mergePlatformConfig(current, patch, secretFields) {
  const previous = isRecord(current) ? current : {};
  const incoming = isRecord(patch) ? patch : {};
  const merged = { ...previous, ...incoming };

  for (const field of secretFields) {
    const value = incoming[field];
    if (typeof value === 'string' && value.startsWith(MASK_PREFIX)) {
      merged[field] = previous[field];
    }
  }

  return merged;
}

export function mergeAdapterSettings(current, patch) {
  const previous = isRecord(current) ? current : {};
  const incoming = isRecord(patch) ? patch : {};
  const merged = { ...previous, ...incoming };

  if (incoming.telegram !== undefined) {
    merged.telegram = mergePlatformConfig(
      previous.telegram,
      incoming.telegram,
      SECRET_FIELDS.telegram,
    );
  }
  if (incoming.feishu !== undefined) {
    merged.feishu = mergePlatformConfig(
      previous.feishu,
      incoming.feishu,
      SECRET_FIELDS.feishu,
    );
  }
  if (incoming.pairing !== undefined) {
    merged.pairing = {
      ...(isRecord(previous.pairing) ? previous.pairing : {}),
      ...(isRecord(incoming.pairing) ? incoming.pairing : {}),
    };
  }

  return merged;
}

function maskSecret(value) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith(MASK_PREFIX)) return value;
  return `${MASK_PREFIX}${value.slice(-4)}`;
}

export function maskAdapterSettings(config) {
  const source = isRecord(config) ? config : {};
  const masked = {
    ...source,
    telegram: isRecord(source.telegram) ? { ...source.telegram } : source.telegram,
    feishu: isRecord(source.feishu) ? { ...source.feishu } : source.feishu,
    pairing: isRecord(source.pairing) ? { ...source.pairing } : source.pairing,
  };

  for (const [platform, fields] of Object.entries(SECRET_FIELDS)) {
    if (!isRecord(masked[platform])) continue;
    for (const field of fields) {
      masked[platform][field] = maskSecret(masked[platform][field]);
    }
  }
  if (isRecord(masked.pairing) && masked.pairing.code) {
    masked.pairing.code = '******';
  }

  return masked;
}

export function hasFeishuAdapterCredentials(config) {
  const feishu = isRecord(config?.feishu) ? config.feishu : {};
  return Boolean(
    typeof feishu.appId === 'string' && feishu.appId.trim() &&
    typeof feishu.appSecret === 'string' && feishu.appSecret.trim(),
  );
}

export function getFeishuAdapterFingerprint(config) {
  if (!hasFeishuAdapterCredentials(config)) return '';
  const feishu = config.feishu;
  return JSON.stringify({
    appId: feishu.appId?.trim() || '',
    appSecret: feishu.appSecret || '',
    encryptKey: feishu.encryptKey || '',
    verificationToken: feishu.verificationToken || '',
    streamingCard: Boolean(feishu.streamingCard),
  });
}

export function applyFeishuPairingAttempt(current, {
  code,
  openId,
  displayName = 'Feishu User',
  now = Date.now(),
} = {}) {
  const source = isRecord(current) ? current : {};
  const pairing = isRecord(source.pairing) ? source.pairing : {};
  const normalizedOpenId = typeof openId === 'string' ? openId.trim() : '';
  if (
    !normalizedOpenId
    || typeof pairing.code !== 'string'
    || !pairing.code
    || !Number.isFinite(pairing.expiresAt)
    || pairing.expiresAt <= now
    || !safeTextEqual(code, pairing.code)
  ) {
    return { matched: false, config: source };
  }

  const feishu = isRecord(source.feishu) ? source.feishu : {};
  const pairedUsers = Array.isArray(feishu.pairedUsers) ? [...feishu.pairedUsers] : [];
  if (!pairedUsers.some((entry) => String(entry?.userId || '') === normalizedOpenId)) {
    pairedUsers.push({
      userId: normalizedOpenId,
      displayName: typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 120)
        : 'Feishu User',
      pairedAt: now,
    });
  }
  return {
    matched: true,
    config: {
      ...source,
      feishu: { ...feishu, pairedUsers },
      pairing: { code: null, expiresAt: null, createdAt: null },
    },
  };
}
