/** Resolve a declared view using Host-owned package and installation metadata. */
export function resolveAppSettingsView(manifest, installation, { settingId, version } = {}) {
  if (!settingId) return null;
  if (!installation?.enabled || installation.activeVersion !== version || manifest.version !== version) throw new Error('App 已停用或版本已变化，请重新打开。');
  const setting = manifest.contributes?.settings?.find(item => item.id === settingId && item.viewId);
  const view = manifest.contributes?.views?.find(item => item.id === setting?.viewId);
  if (!setting || !view || !manifest.ui?.entry) throw new Error('App 未声明此设置页面。');
  if ([setting.permission, view.permission].some(permission => permission && !installation.grants?.includes(permission))) throw new Error('此设置页面尚未授权。');
  return { route: view.route || '#/', settingId: setting.id, version };
}

export function validateAppViewState(input) {
  if (!input || typeof input.dirty !== 'boolean' || typeof input.busy !== 'boolean') throw new Error('无效的页面状态。');
  const state = { dirty: input.dirty, busy: input.busy };
  if (input.returnToPreview !== true) return state;
  if (state.dirty || state.busy) throw new Error('请先处理待保存的修改。');
  const sheet = typeof input.sheet === 'string' && input.sheet.length <= 31 ? input.sheet : undefined;
  const cell = typeof input.cell === 'string' && /^[A-Z]{1,3}\d{1,5}$/.test(input.cell) ? input.cell : undefined;
  return { ...state, returnToPreview: true, saved: input.saved === true, ...(input.previewMode === 'original' || input.previewMode === 'sheets' ? { previewMode: input.previewMode } : {}), sheet, cell };
}
