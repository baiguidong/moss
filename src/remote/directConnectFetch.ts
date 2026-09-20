type DirectConnectFetch = typeof globalThis.fetch

let directConnectFetch: DirectConnectFetch = (...args) => globalThis.fetch(...args)

export function setDirectConnectFetchImplementation(
  fetchImpl?: DirectConnectFetch,
): void {
  directConnectFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args))
}

export function fetchDirectConnect(
  ...args: Parameters<DirectConnectFetch>
): ReturnType<DirectConnectFetch> {
  return directConnectFetch(...args)
}
