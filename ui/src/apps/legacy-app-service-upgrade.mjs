import fs from 'node:fs';
import path from 'node:path';
import { createConnectorCredentialStore } from '../connector-credential-store.mjs';
import { readServiceJson, writeServiceJson, assertServicePath } from './app-service-storage.mjs';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';

// This is the only production reader of the retired ~/.moss/connectors layout.
// Imports are additive and marked only after all writes succeed. A retry must
// never replace newer data or resurrect a credential the user has cleared.
export function createLegacyAppServiceUpgrade({ mossHome, storage }) {
  const legacyRoot = path.join(mossHome, 'connectors');
  const keys = storage.keyPaths;
  const legacyCredentials = () => createConnectorCredentialStore({
    storagePath: path.join(legacyRoot, 'credentials.v3.json'),
    primaryKeyPath: keys.primaryPath, backupKeyPath: keys.backupPath,
  }).read();
  const coreMarker = path.join(mossHome, 'credentials', 'legacy-service-upgrade.json');
  function core() {
    if (fs.existsSync(coreMarker)) return;
    const source = legacyCredentials();
    if (source.webSearchCredentials || source.enterpriseAccountCredentials) {
      storage.coreCredentials.update(current => ({ ...current,
        webSearchCredentials: { ...source.webSearchCredentials, ...current.webSearchCredentials },
        enterpriseAccountCredentials: Object.fromEntries([...new Set([
          ...Object.keys(source.enterpriseAccountCredentials || {}), ...Object.keys(current.enterpriseAccountCredentials || {}),
        ])].map(key => [key, { ...source.enterpriseAccountCredentials?.[key], ...current.enterpriseAccountCredentials?.[key] }])),
      }));
    }
    writeServiceJson(coreMarker, { version: 1 });
  }
  function app({ manifest, root }, { transformConfig = (_name, value) => value } = {}) {
    const appId = manifest.id, id = manifest.connectorApp.id;
    const target = storage.serviceRoot(appId);
    // Kept outside App data so uninstall + deleteData cannot re-import old auth.
    const marker = assertServicePath(mossHome, path.join(mossHome, 'credentials', 'app-service-upgrades', `${appId}.json`));
    if (fs.existsSync(marker)) return;
    const source = assertServicePath(mossHome, path.join(legacyRoot, 'installed', id)), packageRoot = path.join(root, 'connector');
    const meta = readServiceJson(path.join(source, 'connector.json'));
    // Never adopt an uninstalled legacy service or a different App's state.
    if (meta?.appId && meta.appId !== appId) throw new Error(`Legacy service belongs to another App: ${id}`);
    if (meta?.appId === appId) {
      const oldFiles = new Set(readServiceJson(path.join(source, '.app-package-files.json'), []));
      const defaults = readServiceJson(path.join(source, '.app-package-defaults.json'), {});
      const workspace = path.join(target, 'workspace');
      const rebase = value => {
        if (typeof value === 'string') {
          for (const name of [...oldFiles].sort((a, b) => b.length - a.length)) {
            const file = path.resolve(packageRoot, name);
            if (path.relative(packageRoot, file).startsWith('..') || !fs.existsSync(file)) continue;
            value = value.replaceAll(path.join(source, name), file);
          }
          return value.replaceAll(source, workspace);
        }
        if (Array.isArray(value)) return value.map(rebase);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item)]));
        return value;
      };
      for (const name of ['cli.json', 'mcp.json']) {
        const value = readServiceJson(path.join(source, name));
        if (!value) continue;
        const packaged = readServiceJson(path.join(packageRoot, name));
        const effective = transformConfig(name, value, legacyRoot);
        if (!isDeepStrictEqual(effective, packaged) && (!isDeepStrictEqual(value, defaults[name] ?? packaged) || !isDeepStrictEqual(effective, value))) {
          const destination = assertServicePath(mossHome, path.join(target, 'config', name));
          if (!fs.existsSync(destination)) writeServiceJson(destination, rebase(effective));
        }
      }
      const state = readServiceJson(path.join(legacyRoot, 'state', `${id}.json`))
        || readServiceJson(path.join(source, 'state.json'))
        || readServiceJson(path.join(source, 'auth.json'));
      if (state && !fs.existsSync(path.join(target, 'state.json'))) writeServiceJson(path.join(target, 'state.json'), state);
      const excluded = new Set(['connector.json', 'cli.json', 'mcp.json', '.app-package-files.json', '.app-package-defaults.json', 'state.json', 'auth.json']);
      function copyData(directory, relative = '') {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (excluded.has(name)) continue;
          const file = path.join(source, name);
          if (entry.isSymbolicLink()) throw new Error(`Legacy service contains a symbolic link: ${id}/${name}`);
          if (entry.isDirectory()) { copyData(file, name); continue; }
          const packageFile = path.join(packageRoot, name);
          const packageOwned = oldFiles.has(name) || fs.existsSync(packageFile);
          if (packageOwned && fs.existsSync(packageFile) && fs.readFileSync(file).equals(fs.readFileSync(packageFile))) continue;
          // Obsolete or edited package resources are preserved for review, never
          // used instead of the signed package's executable code.
          const destination = assertServicePath(mossHome, path.join(target, packageOwned ? 'legacy-package-edits' : 'workspace', name));
          if (fs.existsSync(destination)) continue;
          fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
          fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(destination, fs.statSync(file).mode & 0o700);
        }
      }
      copyData(source);
      const credentials = legacyCredentials(), store = storage.credentialsForApp(appId);
      const fields = credentials.connectorFields?.[id];
      const tokens = Object.fromEntries(Object.entries(credentials.mcpAccessTokens || {}).filter(([key]) => key.startsWith(`${id}:`)));
      if (fields || Object.keys(tokens).length) store.update(current => ({ ...current,
        connectorFields: { ...current.connectorFields, [id]: { ...fields, ...current.connectorFields?.[id] } },
        mcpAccessTokens: { ...tokens, ...current.mcpAccessTokens },
      }));
    }
    writeServiceJson(marker, { version: 1, imported: meta?.appId === appId });
  }
  function finish(installedApps) {
    if (!fs.existsSync(legacyRoot)) return { retired: false, pending: [] };
    const pending = [];
    for (const installed of installedApps) {
      const id = (installed.connectorApp || installed.manifest?.connectorApp)?.id;
      if (!id) continue;
      const record = storage.get(id);
      if (record?.appId !== installed.id || record.version !== installed.currentVersion
        || !fs.existsSync(path.join(mossHome, 'credentials/app-service-upgrades', `${installed.id}.json`))) pending.push(installed.id);
    }
    if (pending.length) return { retired: false, pending };
    core();
    assertServicePath(mossHome, legacyRoot);
    const archive = assertServicePath(mossHome, path.join(mossHome, 'backups', `connectors-before-app-services-${randomUUID()}`));
    fs.mkdirSync(path.dirname(archive), { recursive: true, mode: 0o700 });
    // Preserve uninstalled services, old credentials and edited resources. This
    // archive is never consulted at runtime or imported again after uninstall.
    fs.renameSync(legacyRoot, archive);
    return { retired: true, archive, pending: [] };
  }
  return { core, app, finish };
}
