import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import semver from 'semver'
import { APP_HOST_API_VERSION } from '../../packages/app-sdk/src/index.mjs'
import { validateAppPackage } from '../../packages/app-runtime/src/index.mjs'
import { downloadFileBuffer } from '../src/download-utils.mjs'
import { extractAppArchive } from '../src/apps/app-runtime.mjs'
import { normalizeMarketplaceIndex, normalizeMarketplaceDetail, selectMarketplaceArtifact } from '../src/apps/app-marketplace.mjs'
import { loadAppMarketConfiguration, loadAppTrustConfiguration } from '../src/apps/app-trust.mjs'

const resources = new URL('../resources/app-market/', import.meta.url)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const execFileAsync = promisify(execFile)

// Build machines may route HTTPS differently through the system HTTP client.
// Keep the same size/hash/signature checks regardless of transport.
async function downloadBuiltinBuffer(url, options) {
  try { return await downloadFileBuffer(url, options) }
  catch (error) {
    if (error.message.includes('size limit')) throw error
    console.log(`Retrying builtin download with curl: ${new URL(url).hostname}`)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtin-download-'))
    try {
      const file = path.join(directory, 'download')
      await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '8', '--connect-timeout', '15', '--max-time', '240', '--max-filesize', String(options.maxBytes), '--output', file, url], { timeout: 250000, maxBuffer: 16384 })
      if ((await fs.stat(file)).size > options.maxBytes) throw new Error('Builtin download exceeds size limit')
      return await fs.readFile(file)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  }
}

export function selectBuiltinVersion(detail, platform, hostApiVersion = APP_HOST_API_VERSION) {
  const supported = detail.versions.filter(version => !semver.prerelease(version.version) && version.platforms.includes(platform))
  if (!supported.length) return null
  const version = supported.sort((a, b) => semver.rcompare(a.version, b.version))
    .find(version => semver.satisfies(hostApiVersion, version.hostApi) && selectMarketplaceArtifact(version, platform))
  if (!version) throw new Error(`No compatible builtin App: ${detail.id} for Host API ${hostApiVersion} on ${platform}`)
  return version
}

export async function stageBuiltinArchive({ bytes, directory, id, platform, version, sha256, size, trustedPublishers, requireTrustedPublisher = true, hostApiVersion = APP_HOST_API_VERSION }) {
  if ((size !== undefined && bytes.length !== size) || (sha256 && digest(bytes) !== sha256)) throw new Error(`Builtin App checksum mismatch: ${id}`)
  const temporary = await fs.mkdtemp(path.join(directory, '.verify-'))
  try {
    const zip = path.join(temporary, 'app.zip'), extracted = path.join(temporary, 'package')
    await fs.writeFile(zip, bytes)
    await extractAppArchive(zip, extracted)
    const pkg = await validateAppPackage(extracted, { platform, hostApiVersion, trustedPublishers, requireTrustedPublisher, requireSource: true })
    if (pkg.manifest.id !== id || (version && pkg.manifest.version !== version)) throw new Error(`Builtin archive identity mismatch: ${id}`)
    const archive = `${id}-${pkg.manifest.version}${pkg.manifest.platforms ? `-${platform}` : ''}.zip`
    await fs.rename(zip, path.join(directory, archive))
    return { id, version: pkg.manifest.version, displayName: pkg.manifest.displayName, description: pkg.manifest.description, archive, bytes: bytes.length, sha256: digest(bytes) }
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

/** Resolve the current catalog on every build; downloaded signed packages stay unchanged. */
export function createBuiltinDownloader({ download = downloadBuiltinBuffer, indexUrl, trustedPublishers, hostApiVersion = APP_HOST_API_VERSION } = {}) {
  const resourceDir = fileURLToPath(resources)
  indexUrl ||= loadAppMarketConfiguration(resourceDir).indexUrl
  trustedPublishers ||= loadAppTrustConfiguration(resourceDir).trustedPublishers
  let index
  const read = async url => JSON.parse((await download(url, { timeoutMs: 30000, maxBytes: 5 * 1024 * 1024 })).toString('utf8'))
  const fresh = url => { const value = new URL(url); value.searchParams.set('_moss_build', String(Date.now())); return value.toString() }
  return async (id, directory, platform) => {
    index ||= normalizeMarketplaceIndex(await read(fresh(indexUrl)), indexUrl)
    const summary = index.apps.find(app => app.id === id)
    if (!summary) throw new Error(`Missing builtin App in marketplace: ${id}`)
    const detail = normalizeMarketplaceDetail(await read(fresh(summary.detailUrl)), summary.detailUrl, id)
    if (detail.latestVersion !== summary.latestVersion) throw new Error(`Builtin catalog changed while resolving ${id}; retry the build`)
    const version = selectBuiltinVersion(detail, platform, hostApiVersion)
    if (!version) return null
    const artifact = selectMarketplaceArtifact(version, platform)
    console.log(`Downloading builtin ${id}@${version.version} for ${platform}`)
    const bytes = await download(artifact.downloadUrl, { timeoutMs: 60000, maxBytes: artifact.size })
    const entry = await stageBuiltinArchive({ bytes, directory, id, platform, version: version.version, sha256: artifact.sha256, size: artifact.size, trustedPublishers, hostApiVersion })
    return { ...entry, source: artifact.downloadUrl }
  }
}
