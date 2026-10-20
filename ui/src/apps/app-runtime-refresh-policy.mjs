// A Backend may report the same health state on every scan. The lightweight
// runtime event already reaches the UI; a catalog refresh would enumerate all Apps.
export function shouldRefreshAppCatalogForRuntimeEvent(event) {
  return !(event?.type === 'status' && event.state === 'running'
    && Object.hasOwn(event, 'backendStatus'))
}
