// Root UI transport capabilities; separate from an App's granted capabilities.
export function createHostCapabilities({ mode = 'desktop', confirmations = false, appInstallation = false, remoteOAuth = false, previewWindows = false, embeddedApps = false, portPreview = false } = {}) {
  const web = mode === 'web';
  return { version: 1, mode, features: {
    confirmations, appInstallation,
    hostFileBrowser: web, browserUpload: web, browserDownload: web,
    embeddedApps: !web || embeddedApps, remoteOAuth: !web || remoteOAuth, nativeBrowser: !web,
    previewWindows: !web || previewWindows, desktopControl: !web, desktopUpdates: !web,
    terminal: true, portPreview,
  } };
}
