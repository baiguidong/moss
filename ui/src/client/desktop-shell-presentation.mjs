// Desktop owns visual preferences; execution settings continue to use the Host.
export async function attachDesktopShellPresentation(client, shell, { storage = localStorage, changed = value => window.dispatchEvent(new CustomEvent('moss:desktop-presentation', { detail: value })) } = {}) {
  let appearance;
  const listeners = new Set();
  let lastSettings;
  const merge = settings => ({ ...settings, appearance });
  const receive = value => {
    if (value.appearance) {
      appearance = value.appearance;
      storage.setItem('ui.appearance', JSON.stringify(appearance));
      storage.setItem('ui.themeMode', appearance.themeMode);
    }
    if (typeof value.panelLayout === 'string') storage.setItem('ui.panelLayout.v1', value.panelLayout);
    changed(value);
    if (lastSettings) for (const listener of listeners) listener(merge(lastSettings));
  };
  receive(await shell.getPresentation());
  const getSettings = client.getSettings, updateSettings = client.updateSettings, onSettingsChanged = client.onSettingsChanged;
  client.getSettings = async () => merge(lastSettings = await getSettings());
  client.updateSettings = async payload => {
    const { appearance: next, ...hostSettings } = payload;
    if (next) receive({ appearance: await shell.updateAppearance(next) });
    lastSettings = Object.keys(hostSettings).length ? await updateSettings(hostSettings) : lastSettings || await getSettings();
    return merge(lastSettings);
  };
  client.onSettingsChanged = callback => {
    listeners.add(callback);
    const stop = onSettingsChanged(settings => { lastSettings = settings; callback(merge(settings)); });
    return () => { listeners.delete(callback); stop(); };
  };
  return shell.onPresentation(receive);
}
