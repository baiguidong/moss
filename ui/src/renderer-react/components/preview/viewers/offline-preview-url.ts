function normalizePortablePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function createOfflinePreviewUrl(filePath: string, rootPath?: string): string {
  const normalizedFile = normalizePortablePath(filePath);
  const lastSlash = normalizedFile.lastIndexOf("/");
  const fallbackRoot = lastSlash > 0 ? normalizedFile.slice(0, lastSlash) : ".";
  let normalizedRoot = normalizePortablePath(rootPath || fallbackRoot) || fallbackRoot;
  const comparableFile = normalizedFile.toLowerCase();
  const comparableRoot = normalizedRoot.toLowerCase();
  if (comparableFile !== comparableRoot && !comparableFile.startsWith(`${comparableRoot}/`)) {
    normalizedRoot = fallbackRoot;
  }
  const relativePath = normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, "")
    || normalizedFile.slice(lastSlash + 1);
  const encodedPath = relativePath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `moss-media://workspace/${encodeURIComponent(normalizedRoot)}/${encodedPath}`;
}
