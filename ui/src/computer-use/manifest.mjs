export const CUA_VERSION = '0.34.0';
export const CUA_HOST_BUNDLE_ID = 'com.moss.ai';
export const CUA_ARTIFACTS = Object.freeze({
  'darwin-arm64': {
    filename: 'cua-driver-rs-0.34.0-darwin-arm64.tar.gz',
    directory: 'cua-driver-rs-0.34.0-darwin-arm64',
    sha256: '329bcc140c4840a5877e2cfc9f756351eb4a70c2c2d6acf4954751918122c60a',
    files: ['cua-driver', 'cua-cursor-theme', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  },
});
export const CUA_TOOLS = Object.freeze([
  'list_apps', 'list_windows', 'launch_app', 'get_window_state',
  'click', 'type_text', 'press_key', 'hotkey', 'scroll', 'set_value',
  'start_session', 'end_session', 'check_permissions', 'health_report',
]);
