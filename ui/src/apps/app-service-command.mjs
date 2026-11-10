import fs from 'node:fs';
import path from 'node:path';

function packageFile(value, packageRoot) {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.startsWith('-')) return value;
  const file = path.resolve(packageRoot, value);
  if (path.relative(packageRoot, file).startsWith('..')) return value;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : value;
}

export function resolveAppServiceInvocation(command, args, packageRoot) {
  const resolved = [...args];
  if (/^(?:node(?:js)?|python(?:3(?:\.\d+)?)?|bash|sh|zsh|pwsh|powershell|bun|deno)(?:\.exe)?$/i.test(path.basename(command))) {
    for (let index = 0; index < resolved.length; index++) {
      const value = resolved[index];
      if (/^(?:-e|-p|-c|--eval|--print|-command|-encodedcommand)(?:=|$)/i.test(value)) break;
      if (['-r', '--require', '--import', '--loader', '--experimental-loader'].includes(value)) {
        if (index + 1 < resolved.length) { index++; resolved[index] = packageFile(resolved[index], packageRoot); }
        continue;
      }
      if (value.startsWith('-')) continue;
      resolved[index] = packageFile(value, packageRoot);
      break;
    }
  }
  return { command: packageFile(command, packageRoot), args: resolved };
}

// Resolve script entrypoints, not arbitrary operands (such as an output file).
// The shell still parses the original command; cwd stays in writable App data.
export function resolveAppServiceCommand(command, packageRoot, platform = process.platform) {
  if (!packageRoot) return command;
  let commandStart = true, scriptArgument = false;
  return command.replace(/"[^"\n]*"|'[^'\n]*'|[;&|()]+|[^\s;&|<>()]+/g, token => {
    if (/^[;&|()]+$/.test(token)) { commandStart = true; scriptArgument = false; return token; }
    const name = /^['"]/.test(token) ? token.slice(1, -1) : token;
    let candidate = false;
    if (commandStart) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name) || ['env', 'exec', 'command'].includes(name)) return token;
      commandStart = false;
      if (/^(?:node(?:js)?|python(?:3(?:\.\d+)?)?|bash|sh|zsh|pwsh|powershell|bun|deno)(?:\.exe)?$/i.test(path.basename(name))) {
        scriptArgument = true;
        return token;
      }
      candidate = true;
    } else if (scriptArgument) {
      // Inline programs and their operands must not be interpreted as filenames.
      if (['-e', '--eval', '-p', '--print', '-c', '-command', '-encodedcommand'].includes(name.toLowerCase())) { scriptArgument = false; return token; }
      if (name.startsWith('-')) return token;
      scriptArgument = false;
      candidate = true;
    }
    if (!candidate || path.isAbsolute(name) || /[$%`\n]/.test(name)) return token;
    const file = path.resolve(packageRoot, name), relative = path.relative(packageRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return token;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return token;
    return platform === 'win32' ? `"${file.replaceAll('"', '""')}"` : `'${file.replaceAll("'", "'\\''")}'`;
  });
}
