import { SQLITE_READONLY_CHECK } from './sqlite-readonly.mjs';
// Sent as source to a network-isolated container. Never starts Electron, Apps,
// migrations, package entrypoints or a shell. HOME is mounted read-only.
export const RESTORE_GUARD = String.raw`
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = fs.realpathSync('/opt/moss');
if (!fs.readFileSync(path.join(root, 'shared/snapshot-runtime.mjs'), 'utf8').includes('SNAPSHOT_PROTOCOL = 1')) throw Error('Snapshot protocol unsupported; upgrade Moss first');
const digest = crypto.createHash('sha256');
function walk(relative) {
  const file = path.join(root, relative), info = fs.lstatSync(file);
  digest.update(relative);
  if (info.isSymbolicLink()) { digest.update(fs.readlinkSync(file)); return; }
  if (info.isDirectory()) { for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name)); }
  else if (info.isFile()) digest.update(fs.readFileSync(file));
}
for (const name of ['package.json', 'ui/package.json', 'ui/src', 'ui/electron-direct.mjs', 'packages/host-contracts', 'shared']) walk(name);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const data = '/volume/.moss/moss.db';
let dataSchema = 'empty';
if (fs.existsSync(data)) dataSchema = JSON.parse(require('node:child_process').execFileSync('/usr/bin/python3', ['-c', ${JSON.stringify(SQLITE_READONLY_CHECK)}, data], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 })).dataSchema;
console.log(JSON.stringify({ protocol: 1, version, dataSchema, programDigest: digest.digest('hex'), architecture: process.arch }));
`;
