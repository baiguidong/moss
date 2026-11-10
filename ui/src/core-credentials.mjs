import { createHash } from 'node:crypto';
import { appServiceStorage, legacyUpgrade } from './apps/app-service-context.mjs';
const normalizeString = value => typeof value === 'string' ? value.trim() : '';
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const coreCredentialStore = {
  read() { legacyUpgrade.core(); return appServiceStorage.coreCredentials.read(); },
  update(mutator) { legacyUpgrade.core(); return appServiceStorage.coreCredentials.update(mutator); },
};

function enterpriseAccountCredentialKey(serverUrl) {
  return createHash('sha256').update(normalizeString(serverUrl), 'utf8').digest('hex');
}

export function getRemoteDirectCredentials(serverUrl) {
  const normalizedServerUrl = normalizeString(serverUrl);
  if (!normalizedServerUrl) return { apiKey: '', userPassword: '' };
  const credentials = coreCredentialStore.read();
  const records = credentials.enterpriseAccountCredentials?.[
    enterpriseAccountCredentialKey(normalizedServerUrl)
  ];
  if (!isPlainObject(records)) return { apiKey: '', userPassword: '' };
  return {
    apiKey: normalizeString(records.apiKey?.value),
    userPassword: typeof records.userPassword?.value === 'string'
      ? records.userPassword.value
      : '',
  };
}

export function saveRemoteDirectCredentials({ serverUrl, apiKey, userPassword }) {
  const normalizedServerUrl = normalizeString(serverUrl);
  if (!normalizedServerUrl) return;
  const serverKey = enterpriseAccountCredentialKey(normalizedServerUrl);
  const updatedAt = new Date().toISOString();
  coreCredentialStore.update((current) => {
    const enterpriseAccountCredentials = isPlainObject(current.enterpriseAccountCredentials)
      ? { ...current.enterpriseAccountCredentials }
      : {};
    const records = {};
    if (normalizeString(apiKey)) {
      records.apiKey = {
        value: normalizeString(apiKey),
        field: 'apiKey',
        serverUrl: normalizedServerUrl,
        updatedAt,
      };
    }
    if (typeof userPassword === 'string' && userPassword) {
      records.userPassword = {
        value: userPassword,
        field: 'userPassword',
        serverUrl: normalizedServerUrl,
        updatedAt,
      };
    }
    if (Object.keys(records).length > 0) enterpriseAccountCredentials[serverKey] = records;
    else delete enterpriseAccountCredentials[serverKey];
    return {
      ...current,
      ...(Object.keys(enterpriseAccountCredentials).length > 0
        ? { enterpriseAccountCredentials }
        : { enterpriseAccountCredentials: {} }),
    };
  });
}

export function getWebSearchCredentials() {
  const credentials = coreCredentialStore.read();
  const records = isPlainObject(credentials.webSearchCredentials)
    ? credentials.webSearchCredentials
    : {};
  return {
    tavilyApiKey: normalizeString(records.tavilyApiKey?.value),
    braveApiKey: normalizeString(records.braveApiKey?.value),
  };
}

export function saveWebSearchCredentials({
  tavilyApiKey,
  braveApiKey,
  clearTavilyApiKey = false,
  clearBraveApiKey = false,
}) {
  const updatedAt = new Date().toISOString();
  coreCredentialStore.update((current) => {
    const existing = isPlainObject(current.webSearchCredentials)
      ? current.webSearchCredentials
      : {};
    const records = { ...existing };
    if (clearTavilyApiKey === true) {
      delete records.tavilyApiKey;
    } else if (normalizeString(tavilyApiKey)) {
      records.tavilyApiKey = {
        value: normalizeString(tavilyApiKey),
        field: 'tavilyApiKey',
        updatedAt,
      };
    }
    if (clearBraveApiKey === true) {
      delete records.braveApiKey;
    } else if (normalizeString(braveApiKey)) {
      records.braveApiKey = {
        value: normalizeString(braveApiKey),
        field: 'braveApiKey',
        updatedAt,
      };
    }
    return {
      ...current,
      webSearchCredentials: records,
    };
  });
}

