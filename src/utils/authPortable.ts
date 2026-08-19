export function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey.slice(-20)
}
