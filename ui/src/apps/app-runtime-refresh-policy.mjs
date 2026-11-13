// A Backend may report the same health state on every scan. The lightweight
// runtime event already reaches the UI; a catalog refresh would enumerate all Apps.
export function shouldRefreshAppCatalogForRuntimeEvent(event) {
  // Runtime status is already delivered through `app:runtime-event`. Rebuilding
  // the App catalog for it can start resource-provider backends, which emits
  // another status event and makes the composer refresh in a loop.
  if (event?.type === 'status') return false
  return true
}
