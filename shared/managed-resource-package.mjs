// Both the server and host accept a ZIP root or one enclosing directory.
export function managedPackageFiles(zip, kind) {
  const entryPoint = kind === 'skill' ? 'SKILL.md' : 'assistant.md';
  const files = Object.values(zip.files).filter(entry => !entry.dir && !entry.name.startsWith('__MACOSX/') && !entry.name.endsWith('.DS_Store'));
  const root = files.find(entry => entry.name === entryPoint) ||
    files.find(entry => entry.name.split('/').length === 2 && entry.name.endsWith('/' + entryPoint));
  if (!root) throw new Error(`ZIP 缺少 ${entryPoint}`);
  const prefix = root.name.slice(0, -entryPoint.length);
  return files.map(entry => {
    const name = entry.name.slice(prefix.length);
    const original = entry.unsafeOriginalName?.replace(/^(?:\.\/)+/, '');
    if (!entry.name.startsWith(prefix) || original && original !== entry.name ||
        name.includes('\\') || name.includes(':') || name.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('ZIP 文件路径无效');
    }
    return { name, entry };
  });
}
