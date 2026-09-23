// Run the same HTTP + Host suite through Electron's real network stack.
const { app, net, session } = require('electron')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { X509Certificate } = require('node:crypto')
let expectedCertificate
if (process.env.MOSS_CLOUD_TEST_CA) {
  expectedCertificate = new X509Certificate(readFileSync(process.env.MOSS_CLOUD_TEST_CA)).fingerprint256
}
const profileDirectory = mkdtempSync(join(tmpdir(), 'moss-cloud-electron-'))
app.setPath('userData', profileDirectory)
app.on('quit', () => rmSync(profileDirectory, { recursive: true, force: true }))
app.commandLine.appendSwitch('disable-http-cache')
app.whenReady().then(async () => {
  if (expectedCertificate) {
    // net.fetch uses the session verifier, not a WebContents certificate event.
    session.defaultSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
      let trusted = false
      try { trusted = hostname === '127.0.0.1' && new X509Certificate(certificate.data).fingerprint256 === expectedCertificate } catch {}
      callback(trusted ? 0 : -3)
    })
  }
  globalThis.fetch = (input, init) => net.fetch(input, init)
  try { await import(pathToFileURL(process.argv[2]).href); app.exit(0) }
  catch (error) { console.error(error); app.exit(1) }
})
