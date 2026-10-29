type ViewState = { dirty: boolean; busy: boolean };
let current: ViewState | null = null;
let leaveApproved = false;

export function setAppViewGuard(state: ViewState | null) { current = state; }
export function confirmAppViewLeave() {
  if (leaveApproved) return true;
  if (current?.busy) { window.alert('设置正在保存，请稍候。'); return false; }
  if (current?.dirty && !window.confirm('有未保存的修改，确定离开并放弃修改吗？')) return false;
  // One click can pass both the document guard and a navigation callback.
  // Keep the dirty state if the click does not actually unmount the page.
  leaveApproved = true;
  queueMicrotask(() => { leaveApproved = false; });
  return true;
}
