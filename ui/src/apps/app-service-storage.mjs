import fs from 'node:fs';
import path from 'node:path';
import { createConnectorCredentialStore } from '../connector-credential-store.mjs';
import { getMossCredentialMasterKeyPaths, writePrivateFileAtomic } from '../../../shared/security/credential-crypto.mjs';

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value.length > 160) throw new Error('Invalid App service identity');
  return value;
}
export function readServiceJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function writeServiceJson(file, value) {
  writePrivateFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function assertServicePath(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('App service path escapes data root');
  let current = root;
  for (const segment of ['', ...relative.split(path.sep)]) {
    current = segment ? path.join(current, segment) : current;
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`App service path must not be a symbolic link: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

/** Package resources stay in the installed version. Only mutable data lives here. */
export function createAppServiceStorage({ mossHome, keyPaths = getMossCredentialMasterKeyPaths(mossHome) }) {
  const dataRoot = path.join(mossHome, 'apps-data');
  const records = new Map();
  const keys = keyPaths;
  const credentialStore = (file, identity) => createConnectorCredentialStore({
    storagePath: file, primaryKeyPath: keys.primaryPath, backupKeyPath: keys.backupPath,
    identity, scope: 'app-service-credentials',
  });
  let loaded = false;
  const serviceRoot = appId => assertServicePath(mossHome, path.join(dataRoot, identifier(appId), 'service'));
  function load() {
    if (loaded) return;
    for (const entry of fs.existsSync(dataRoot) ? fs.readdirSync(dataRoot, { withFileTypes: true }) : []) {
      if (!entry.isDirectory()) continue;
      const record = readServiceJson(assertServicePath(mossHome, path.join(dataRoot, entry.name, 'service', 'activation.json')));
      if (!record) continue;
      if (record.appId !== entry.name || !record.id || !path.isAbsolute(record.packageRoot || '')) throw new Error('Invalid App service activation');
      identifier(record.id);
      if (records.has(record.id) && records.get(record.id).appId !== record.appId) throw new Error(`Duplicate App service: ${record.id}`);
      records.set(record.id, record);
    }
    loaded = true;
  }
  function get(id) { load(); return records.get(identifier(id)) || null; }
  function requireRecord(id) {
    const record = get(id);
    if (!record) throw new Error(`App service is not installed: ${id}`);
    return record;
  }
  function rootFor(id) { return serviceRoot(requireRecord(id).appId); }
  function workspace(id) { return assertServicePath(mossHome, path.join(rootFor(id), 'workspace')); }
  function read(id, name, fallback = null) {
    const record = get(id);
    if (!record) return fallback;
    if (!['connector.json', 'cli.json', 'mcp.json', 'token-schema.json'].includes(name)) throw new Error('Invalid App service resource');
    if (name === 'connector.json') {
      const meta = readServiceJson(path.join(record.packageRoot, name), fallback);
      return meta ? { ...meta, ...record, appVersion: record.version } : fallback;
    }
    if (['cli.json', 'mcp.json'].includes(name)) {
      const override = assertServicePath(mossHome, path.join(rootFor(id), 'config', name));
      if (fs.existsSync(override)) return readServiceJson(override, fallback);
    }
    return readServiceJson(path.join(record.packageRoot, name), fallback);
  }
  function activate({ manifest, root }, isCurrent = () => true) {
    load();
    const id = identifier(manifest.connectorApp.id), appId = identifier(manifest.id);
    const packageRoot = path.join(root, 'connector');
    if (readServiceJson(path.join(packageRoot, 'connector.json'))?.id !== id) throw new Error('App service identity mismatch');
    const previous = records.get(id);
    if (previous && previous.appId !== appId) throw new Error(`App service ${id} is already owned by ${previous.appId}`);
    if (!isCurrent()) return false;
    const record = { id, appId, version: manifest.version, packageRoot, enabled: true,
      installedAt: previous?.installedAt || new Date().toISOString() };
    fs.mkdirSync(assertServicePath(mossHome, path.join(serviceRoot(appId), 'workspace')), { recursive: true });
    writeServiceJson(path.join(serviceRoot(appId), 'activation.json'), record);
    records.set(id, record);
    return true;
  }
  function deactivate(id, { deleteData = false, deleteCredentials = false } = {}) {
    const record = get(id);
    if (!record) return;
    const root = rootFor(id);
    if (deleteData) {
      for (const name of ['workspace', 'config', 'state.json', 'legacy-package-edits']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
    if (deleteCredentials) {
      fs.rmSync(path.join(root, 'credentials.v3.json'), { force: true });
      writeServiceJson(path.join(root, 'state.json'), { connected: false, setupStatus: 'needs-auth' });
    }
    record.enabled = false;
    writeServiceJson(path.join(root, 'activation.json'), record);
  }
  function retainCredentials(appId) {
    const store = credentialStore(path.join(serviceRoot(appId), 'credentials.v3.json'), `moss-app:${identifier(appId)}`);
    const data = store.read();
    return () => {
      if (Object.keys(data.connectorFields || {}).length || Object.keys(data.mcpAccessTokens || {}).length) store.write(data);
    };
  }
  return {
    dataRoot, keyPaths, get, read, activate, deactivate, serviceRoot, rootFor, workspace, retainCredentials,
    list: () => { load(); return [...records.values()]; },
    statePath: id => path.join(rootFor(id), 'state.json'),
    credentials: id => credentialStore(path.join(rootFor(id), 'credentials.v3.json'), `moss-app:${requireRecord(id).appId}`),
    credentialsForApp: appId => credentialStore(path.join(serviceRoot(appId), 'credentials.v3.json'), `moss-app:${identifier(appId)}`),
    coreCredentials: credentialStore(path.join(mossHome, 'credentials', 'core.v3.json'), 'moss-core'),
  };
}
