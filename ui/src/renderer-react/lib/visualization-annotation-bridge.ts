// Serialized into the sandbox. Keep this function independent of module scope.
export function visualizationAnnotationBridge(channel: string, token: string) {
  let mode: 'element' | 'text' | 'region' | null = null;
  let highlight: HTMLDivElement | null = null;
  let start: { x: number; y: number; target: Element } | null = null;
  let selected: { rect: { x: number; y: number; width: number; height: number }; element?: Element; range?: Range } | null = null;
  let lastTarget: Element | null = null;
  const send = (type: string, payload: unknown) => parent.postMessage({ channel, token, type, payload }, '*');
  const rectValue = (rect: DOMRect) => ({ x: Math.max(0, rect.left + scrollX), y: Math.max(0, rect.top + scrollY), width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
  const selector = (node: Element) => {
    const parts = [];
    for (let element: Element | null = node; element && element !== document.body && parts.length < 8; element = element.parentElement) {
      if (element.id) { parts.unshift('#' + CSS.escape(element.id)); break; }
      const siblings = [...(element.parentElement?.children || [])].filter(item => item.localName === element!.localName);
      parts.unshift(`${element.localName}:nth-of-type(${siblings.indexOf(element) + 1})`);
    }
    return parts.join(' > ').slice(0, 1000);
  };
  const text = (node: Element | null) => (node?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 2000);
  const show = (rect: { x: number; y: number; width: number; height: number } | null) => {
    if (!rect) { highlight?.remove(); highlight = null; return; }
    if (!highlight) { highlight = document.createElement('div'); highlight.dataset.mossAnnotation = ''; document.body.append(highlight); }
    Object.assign(highlight.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #4c8dff', background: 'rgba(76,141,255,.10)', borderRadius: '3px', boxSizing: 'border-box',
      left: `${rect.x - scrollX}px`, top: `${rect.y - scrollY}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const anchor = () => {
    if (!selected) return;
    if (selected.range) selected.rect = rectValue(selected.range.getBoundingClientRect());
    else if (selected.element?.isConnected) selected.rect = rectValue(selected.element.getBoundingClientRect());
    show(selected.rect);
    send('annotation-position', { x: selected.rect.x - scrollX, y: selected.rect.y - scrollY, width: selected.rect.width, height: selected.rect.height });
  };
  const commit = (kind: 'element' | 'text' | 'region', target: Element, rect: ReturnType<typeof rectValue>, selectedText: string, prompt = '', range?: Range) => {
    selected = { rect, ...(kind === 'element' ? { element: target } : {}), ...(range ? { range } : {}) };
    send('annotation-selection', { selection: { kind, selector: selector(target), text: selectedText.slice(0, 2000), nearbyText: text(target.parentElement), rect }, prompt });
    anchor();
  };
  const setMode = (value: typeof mode) => {
    mode = value; start = null; selected = null; show(null);
    document.documentElement.dataset.mossAnnotating = value || '';
    getSelection()?.removeAllRanges();
  };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.channel !== channel || data.token !== token) return;
    if (data.type === 'annotation-mode' && [null, 'element', 'text', 'region'].includes(data.payload)) setMode(data.payload);
    if (data.type === 'annotation-clear') { selected = null; start = null; show(null); getSelection()?.removeAllRanges(); }
  });
  addEventListener('pointerdown', event => {
    if (!(event.target instanceof Element) || event.button !== 0) return;
    lastTarget = event.target;
    if (!mode || mode === 'text') return;
    event.preventDefault(); event.stopImmediatePropagation();
    start = { x: event.clientX + scrollX, y: event.clientY + scrollY, target: event.target };
  }, true);
  const dragRect = (event: PointerEvent) => ({ x: Math.min(start!.x, event.clientX + scrollX), y: Math.min(start!.y, event.clientY + scrollY),
    width: Math.max(1, Math.abs(event.clientX + scrollX - start!.x)), height: Math.max(1, Math.abs(event.clientY + scrollY - start!.y)) });
  addEventListener('pointermove', event => {
    if (!mode || mode === 'text') return;
    if (start) show(dragRect(event));
    else if (!selected && event.target instanceof Element) show(rectValue(event.target.getBoundingClientRect()));
    event.stopImmediatePropagation();
  }, true);
  addEventListener('pointerup', event => {
    if (!mode) return;
    if (mode === 'text') {
      setTimeout(() => {
        const selection = getSelection();
        if (mode !== 'text' || !selection?.rangeCount || !selection.toString().trim()) return;
        const range = selection.getRangeAt(0).cloneRange(), node = range.commonAncestorContainer;
        const target = node instanceof Element ? node : node.parentElement;
        if (target) commit('text', target, rectValue(range.getBoundingClientRect()), selection.toString().trim(), '', range);
      }, 0);
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (!start) return;
    const rect = dragRect(event), target = start.target;
    const region = mode === 'region' || rect.width > 6 || rect.height > 6;
    start = null;
    if (!region) return commit('element', target, rectValue(target.getBoundingClientRect()), text(target));
    const pieces: string[] = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null, visited = 0;
    while ((node = walker.nextNode()) && ++visited < 5000 && pieces.join(' ').length < 2000) {
      if (!node.textContent?.trim() || node.parentElement?.closest('script,style,[data-moss-annotation]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const box = rectValue(range.getBoundingClientRect());
      if (box.x < rect.x + rect.width && box.x + box.width > rect.x && box.y < rect.y + rect.height && box.y + box.height > rect.y) pieces.push(node.textContent.trim());
    }
    commit('region', target, rect, pieces.join(' '));
  }, true);
  addEventListener('click', event => { if (mode) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  addEventListener('keydown', event => { if (mode && event.key === 'Escape') { setMode(null); send('annotation-cancel', null); } }, true);
  addEventListener('scroll', anchor, true); addEventListener('resize', anchor);
  addEventListener('moss:follow-up', event => {
    const prompt = (event as CustomEvent).detail?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) return;
    const target = lastTarget?.isConnected ? lastTarget : document.activeElement || document.body;
    commit('element', target, rectValue(target.getBoundingClientRect()), text(target), prompt);
  });
}
