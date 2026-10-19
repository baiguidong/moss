#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platforms = new Set(['linux/amd64', 'linux/arm64']);
const deployFiles = ['README.md', 'compose.yaml', 'compose.managed.yaml', '.env.example', 'manage.sh'];

export const usage = `Usage:
  node scripts/docker-webui.mjs build [options]
  node scripts/docker-webui.mjs package [options]

  build     Build and load an image; --push explicitly publishes to a registry.
  package   Build, load and export a self-contained offline deployment archive.

Options:
  --platform <platforms>  linux/amd64 or linux/arm64; defaults to Docker's platform.
                         Multiple platforms require build --push.
  --tag <image>           Default: moss-webui:local (build or --skip-build),
                         moss-webui:<version>-<arch> (package with build).
  --version <version>     Release/package version; defaults to package.json version.
  --node-image <image>    Override NODE_IMAGE (or MOSS_WEB_NODE_IMAGE).
  --output-dir <path>     Package directory; default: deploy/webui/dist.
  --skip-build           Package an existing local image; verify its architecture.
  --load                 Load locally (default); single platform only.
  --push                 Build and publish; unavailable for offline packages.
  --no-cache             Disable build cache.
  --progress <mode>      auto, plain, tty, quiet or rawjson.
  -h, --help             Show help without requiring Docker.

Examples:
  bun run docker:build-webui -- --platform linux/amd64
  bun run docker:package-webui -- --platform linux/arm64 --version 0.1.0
  bun run docker:package-webui -- --skip-build --tag moss-webui:local
`;

export function parseOptions(argv) {
  const args = [...argv];
  const command = args.shift();
  if (args[0] === '--') args.shift(); // npm/bun script argument separator
  if (command === '--help' || command === '-h') return { help: true };
  if (!['build', 'package'].includes(command)) throw new Error('Choose build or package.');
  const { values } = parseArgs({ args, strict: true, options: {
    platform: { type: 'string' }, tag: { type: 'string' }, version: { type: 'string' },
    'node-image': { type: 'string' }, 'output-dir': { type: 'string' },
    'skip-build': { type: 'boolean' }, load: { type: 'boolean' }, push: { type: 'boolean' },
    'no-cache': { type: 'boolean' }, progress: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return { help: true };
  for (const key of ['platform', 'tag', 'version', 'node-image', 'output-dir', 'progress']) {
    if (values[key] !== undefined && (!values[key].trim() || values[key].startsWith('-'))) {
      throw new Error(`Invalid --${key} value.`);
    }
  }
  if (values.version && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(values.version)) {
    throw new Error('--version must contain only letters, numbers, dots, underscores and dashes.');
  }
  if (values.tag && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(values.tag)) {
    throw new Error('--tag must be a Docker image tag, without a digest or shell metacharacters.');
  }
  if (values.progress && !['auto', 'plain', 'tty', 'quiet', 'rawjson'].includes(values.progress)) {
    throw new Error('Unsupported --progress mode.');
  }
  const selectedPlatforms = values.platform?.split(',').map(value => value.trim());
  if (selectedPlatforms && (selectedPlatforms.some(value => !platforms.has(value)) || new Set(selectedPlatforms).size !== selectedPlatforms.length)) {
    throw new Error('--platform accepts distinct linux/amd64 and linux/arm64 values.');
  }
  if (values.load && values.push) throw new Error('Choose --load or --push.');
  if (command === 'package' && values.push) throw new Error('Offline packaging does not support --push.');
  if (selectedPlatforms?.length > 1 && (command === 'package' || !values.push)) {
    throw new Error('Multi-platform builds require build --push. Package each architecture separately.');
  }
  if (command === 'build' && (values['skip-build'] || values['output-dir'])) {
    throw new Error('--skip-build and --output-dir are package options.');
  }
  if (values['skip-build'] && (values['node-image'] || values['no-cache'] || values.progress)) {
    throw new Error('Build options cannot be used with --skip-build.');
  }
  return { command, ...values, platforms: selectedPlatforms };
}

function run(command, args, { capture = false, cwd = repoRoot } = {}) {
  if (!capture) console.log(`$ ${[command, ...args].map(value => JSON.stringify(value)).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd, env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})${capture ? `: ${result.stderr.trim()}` : ''}`);
  return capture ? result.stdout.trim() : '';
}

function normalizePlatform(value) {
  return value.replace(/\/aarch64$/, '/arm64').replace(/\/x86_64$/, '/amd64');
}

function inspectImage(tag, execute) {
  const [image] = JSON.parse(execute('docker', ['image', 'inspect', tag], { capture: true }));
  if (!image?.Id || !image.Os || !image.Architecture) throw new Error('Docker returned incomplete image metadata.');
  return image;
}

export function buildArguments(options) {
  const args = ['buildx', 'build', '--platform', options.platforms.join(','), '--tag', options.tag,
    '--file', 'docker/webui/Dockerfile', '--build-arg', `MOSS_VERSION=${options.version}`];
  if (options['node-image']) args.push('--build-arg', `NODE_IMAGE=${options['node-image']}`);
  if (options['no-cache']) args.push('--no-cache');
  if (options.progress) args.push('--progress', options.progress);
  args.push(options.push ? '--push' : '--load', '.');
  return args;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function executeRelease(input, { root = repoRoot, execute = run } = {}) {
  const options = { ...input };
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  options.version ||= metadata.version;
  // Validate defaults too, before constructing file names or invoking Docker.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.version)) throw new Error('Invalid package version.');
  let image;
  if (options['skip-build']) {
    options.tag ||= 'moss-webui:local';
    image = inspectImage(options.tag, execute);
  }
  options.platforms ||= [normalizePlatform(image ? `${image.Os}/${image.Architecture}`
    : execute('docker', ['info', '--format', '{{.OSType}}/{{.Architecture}}'], { capture: true }))];
  if (options.platforms.some(value => !platforms.has(value))) throw new Error('Only Linux amd64/arm64 images are supported.');
  const arch = options.platforms[0].split('/')[1];
  options.tag ||= options.command === 'package' ? `moss-webui:${options.version}-${arch}` : 'moss-webui:local';
  options['node-image'] ||= process.env.MOSS_WEB_NODE_IMAGE;
  const output = path.resolve(options['output-dir'] || path.join(root, 'deploy/webui/dist'));
  const basename = `moss-webui-${options.version}-linux-${arch}.tar.gz`;
  const archive = path.join(output, basename);
  let temporary;
  let lock;
  let published = false;
  try {
    if (options.command === 'package') {
      await fs.mkdir(output, { recursive: true });
      lock = await fs.open(`${archive}.lock`, 'wx');
      for (const file of [archive, `${archive}.sha256`]) {
        try { await fs.access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw new Error(`Output already exists: ${file}. Choose another --version or --output-dir.`);
      }
    }
    if (!options['skip-build']) execute('docker', buildArguments(options), { cwd: root });
    if (options.command === 'build') return { tag: options.tag, platforms: options.platforms, pushed: !!options.push };
    image ||= inspectImage(options.tag, execute);
    if (`${image.Os}/${image.Architecture}` !== options.platforms[0]) {
      throw new Error(`Image is ${image.Os}/${image.Architecture}, expected ${options.platforms[0]}. Rebuild for the requested architecture.`);
    }
    temporary = await fs.mkdtemp(path.join(output, '.moss-webui-'));
    const stage = path.join(temporary, 'moss-webui');
    await fs.mkdir(path.join(stage, 'images'), { recursive: true });
    // Allowlist only: never package checkout .env, user volumes or build secrets.
    for (const name of deployFiles) await fs.copyFile(path.join(root, 'deploy/webui', name), path.join(stage, name));
    const example = await fs.readFile(path.join(stage, '.env.example'), 'utf8');
    await fs.writeFile(path.join(stage, '.env.example'), example.replace(/^MOSS_WEB_IMAGE=.*$/m, `MOSS_WEB_IMAGE=${options.tag}`));
    await fs.chmod(path.join(stage, 'manage.sh'), 0o755);
    execute('docker', ['save', '--output', path.join(stage, 'images/moss-webui.tar'), options.tag]);
    // Guard against another build retagging the source while it is exported.
    if (inspectImage(options.tag, execute).Id !== image.Id) throw new Error('Image tag changed while exporting; retry with a stable tag.');
    const release = {
      schemaVersion: 1, packageVersion: options.version, packagedAt: new Date().toISOString(),
      builtFromCheckout: !options['skip-build'],
      image: { reference: options.tag, id: image.Id, platform: options.platforms[0], created: image.Created,
        labels: image.Config?.Labels || {}, repoDigests: image.RepoDigests || [] },
      persistence: { homeVolume: true, systemLayerOnContainerReplacement: false },
    };
    await fs.writeFile(path.join(stage, 'release.json'), JSON.stringify(release, null, 2) + '\n');
    const checks = await Promise.all([...deployFiles, 'release.json', 'images/moss-webui.tar'].map(async name => `${await sha256(path.join(stage, name))}  ${name}\n`));
    await fs.writeFile(path.join(stage, 'SHA256SUMS'), checks.join(''));
    const stagedArchive = path.join(temporary, basename);
    execute('tar', ['--no-xattrs', '-czf', stagedArchive, '-C', temporary, 'moss-webui']);
    const checksum = `${await sha256(stagedArchive)}  ${basename}\n`;
    await fs.writeFile(path.join(temporary, 'checksum'), checksum);
    // Hard links publish complete files without overwriting an earlier release.
    await fs.link(stagedArchive, archive);
    published = true;
    await fs.link(path.join(temporary, 'checksum'), `${archive}.sha256`);
    console.log(`Package: ${archive}\nChecksum: ${archive}.sha256\nPlatform: ${options.platforms[0]}`);
    return { archive, checksum: `${archive}.sha256`, release };
  } catch (error) {
    if (published) await fs.rm(archive, { force: true });
    throw error;
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    if (lock) { await lock.close(); await fs.rm(`${archive}.lock`, { force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(usage);
    else await executeRelease(options);
  } catch (error) {
    console.error(`WebUI release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
