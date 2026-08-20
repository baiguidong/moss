/**
 * Moss Server MCP registry lookups are disabled in this build.
 */
export async function prefetchOfficialMcpUrls(): Promise<void> {
  return
}

export function isOfficialMcpUrl(_normalizedUrl: string): boolean {
  return false
}

export function resetOfficialMcpUrlsForTesting(): void {
  return
}
