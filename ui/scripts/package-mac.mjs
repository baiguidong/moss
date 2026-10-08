import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = ['--mac', '--arm64', '--publish', 'never'];
const identity = process.env.MOSS_MAC_SIGNING_IDENTITY?.trim();
if (identity) {
  args.push(`--config.mac.identity=${identity}`, '--config.mac.hardenedRuntime=true',
    `--config.mac.notarize=${process.env.MOSS_MAC_NOTARIZE === 'true'}`);
}
if (process.env.MOSS_PACKAGE_VERSION) args.push(`--config.extraMetadata.version=${process.env.MOSS_PACKAGE_VERSION}`);
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...args], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
