import type { CSSProperties } from 'react';
// CSS variables keep code highlighting in sync with live theme/color previews.
export const mossSyntaxTheme: Record<string, CSSProperties> = {
  hljs: { color: 'var(--color-code-fg)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 'var(--moss-code-size)' },
  'hljs-comment': { color: 'var(--color-code-comment)', fontStyle: 'italic' },
  'hljs-quote': { color: 'var(--color-code-comment)' },
  'hljs-keyword': { color: 'var(--color-code-keyword)' },
  'hljs-doctag': { color: 'var(--color-code-keyword)' },
  'hljs-literal': { color: 'var(--color-code-number)' },
  'hljs-number': { color: 'var(--color-code-number)' },
  'hljs-string': { color: 'var(--color-code-string)' },
  'hljs-regexp': { color: 'var(--color-code-string)' },
  'hljs-built_in': { color: 'var(--color-code-type)' },
  'hljs-type': { color: 'var(--color-code-type)' },
  'hljs-title': { color: 'var(--color-code-function)' },
  'hljs-name': { color: 'var(--color-code-keyword)' },
  'hljs-attr': { color: 'var(--color-code-property)' },
  'hljs-symbol': { color: 'var(--color-code-keyword)' },
  'hljs-variable': { color: 'var(--color-code-fg)' },
  'hljs-meta': { color: 'var(--color-code-keyword)' },
  'hljs-addition': { color: 'var(--color-diff-added-text)', background: 'var(--color-diff-added-bg)' },
  'hljs-deletion': { color: 'var(--color-diff-removed-text)', background: 'var(--color-diff-removed-bg)' },
};
