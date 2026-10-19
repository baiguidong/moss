export type HostCapabilities = {
  version: 1; mode: 'desktop' | 'web'; features: {
    confirmations: boolean; appInstallation: boolean; hostFileBrowser: boolean;
    browserUpload: boolean; browserDownload: boolean; embeddedApps: boolean;
    remoteOAuth: boolean; nativeBrowser: boolean; previewWindows: boolean;
    desktopControl: boolean; desktopUpdates: boolean; terminal: boolean; portPreview: boolean;
  };
};
export function createHostCapabilities(options?: { mode?: 'desktop' | 'web'; confirmations?: boolean; appInstallation?: boolean; remoteOAuth?: boolean; previewWindows?: boolean; embeddedApps?: boolean; portPreview?: boolean }): HostCapabilities;
