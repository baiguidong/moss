// Only unambiguous paths in prose become candidates. The renderer checks existence.
// Never rewrite links, code, images, HTML or URL contents.
export function remarkFileReferences() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (['link', 'linkReference', 'image', 'code', 'inlineCode', 'html'].includes(node.type) || !node.children) return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== 'text') { walk(child); return [child]; }
        const value: string = child.value;
        const pattern = /(^|[\s：，；（(])((?:\/(?!\/)|[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/])[^\s<>"'`，。；！？、）)\[\]{}]+)/g;
        const parts: any[] = []; let end = 0;
        for (const match of value.matchAll(pattern)) {
          const start = match.index! + match[1].length;
          const reference = match[2].replace(/[.,;!?]+$/, '');
          if (!reference || reference === '/') continue;
          if (start > end) parts.push({ type: 'text', value: value.slice(end, start) });
          parts.push({ type: 'link', url: reference, data: { hProperties: { 'data-file-reference': true } }, children: [{ type: 'text', value: reference }] });
          end = start + reference.length;
        }
        if (!parts.length) return [child];
        if (end < value.length) parts.push({ type: 'text', value: value.slice(end) });
        return parts;
      });
    };
    walk(tree);
  };
}
