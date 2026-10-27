// Bun can inline absolute dependency paths in CommonJS wrappers. Never cross
// a line boundary: quotes inside a regex can precede a dependency-path comment.
export function sanitizeBundledPaths(source) {
  return source.replace(
    /(["'])\/[^"'\r\n]*?\/node_modules\//g,
    (_match, quote) => quote + './node_modules/',
  )
}
