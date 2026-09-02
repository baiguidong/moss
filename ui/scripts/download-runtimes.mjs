#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RUNTIME_ARTIFACTS,
  SUPPORTED_RUNTIME_TARGETS,
} from '../src/runtime/runtime-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(UI_ROOT, 'resources', 'runtimes');
const DOWNLOAD_TIMEOUT_MS = Number(process.env.MOSS_RUNTIME_DOWNLOAD_TIMEOUT_MS) || 600_000;
const DOWNLOAD_ATTEMPTS = 3;

export function parseTargets(args, platform = process.platform, arch = process.arch) {
  const requested = args.includes('--all')
    ? [...SUPPORTED_RUNTIME_TARGETS]
    : [args.find((arg) => arg.startsWith('--target='))?.slice('--target='.length)
      || `${platform}-${arch}`];

  for (const target of requested) {
    if (!RUNTIME_ARTIFACTS[target]) {
      throw new Error(`Unsupported runtime target: ${target}. Supported targets: ${SUPPORTED_RUNTIME_TARGETS.join(', ')}`);
    }
  }
  return requested;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadOnce(url, destination) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'moss-runtime-downloader' },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function downloadWithRetry(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await fsp.rm(destination, { force: true });
      await downloadOnce(url, destination);
      return;
    } catch (error) {
      lastError = error;
      await fsp.rm(destination, { force: true });
      if (attempt < DOWNLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

export async function ensureArtifact(artifact, { force = false } = {}) {
  const destination = path.join(OUT_DIR, artifact.filename);
  await fsp.mkdir(OUT_DIR, { recursive: true });

  if (!force && fs.existsSync(destination)) {
    const existingHash = await sha256File(destination);
    if (existingHash === artifact.sha256) {
      console.log(`verified ${path.relative(process.cwd(), destination)}`);
      return destination;
    }
    console.warn(`replace checksum mismatch ${path.relative(process.cwd(), destination)}`);
  }

  const tempPath = `${destination}.tmp`;
  console.log(`download ${artifact.url}`);
  await downloadWithRetry(artifact.url, tempPath);
  const actualHash = await sha256File(tempPath);
  if (actualHash !== artifact.sha256) {
    await fsp.rm(tempPath, { force: true });
    throw new Error(`Checksum mismatch for ${artifact.filename}: expected ${artifact.sha256}, got ${actualHash}`);
  }
  await fsp.rm(destination, { force: true });
  await fsp.rename(tempPath, destination);
  console.log(`saved ${path.relative(process.cwd(), destination)}`);
  return destination;
}

export async function main(args = process.argv.slice(2)) {
  const targets = parseTargets(args);
  for (const target of targets) {
    console.log(`target ${target}`);
    for (const artifact of Object.values(RUNTIME_ARTIFACTS[target])) {
      await ensureArtifact(artifact, { force: args.includes('--force') });
    }
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
