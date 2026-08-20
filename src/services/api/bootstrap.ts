/**
 * Moss Server bootstrap is disabled in this build.
 *
 * Keep the public startup hook as a no-op so callers do not need conditional
 * imports while the client no longer contacts a server for bootstrap data.
 */
export async function fetchBootstrapData(): Promise<void> {
  return
}
