export const PRESENTATION_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 32, items: {
      type: 'object', additionalProperties: false,
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 8192 },
        resource_uri: { type: 'string', minLength: 1, maxLength: 8192 },
        artifact_id: { type: 'string', minLength: 1, maxLength: 8192 },
        title: { type: 'string', maxLength: 256 },
        role: { type: 'string', enum: ['primary', 'supporting'] },
        view: { type: 'string', enum: ['auto', 'source', 'rendered'] },
      },
    } },
    title: { type: 'string', maxLength: 256 },
    mode: { type: 'string', enum: ['auto', 'background'] },
  }, required: ['items'],
};

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validatePresentationInput(input) {
  const fail = () => { throw new Error('Invalid presentation: provide 1–32 items, exactly one path/resource_uri/artifact_id per item, and at most one primary.'); };
  if (!object(input) || Object.keys(input).some(key => !['items', 'title', 'mode'].includes(key))) fail();
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 32) fail();
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 256)) fail();
  if (input.mode !== undefined && !['auto', 'background'].includes(input.mode)) fail();
  let primary = 0;
  const items = input.items.map(item => {
    if (!object(item) || Object.keys(item).some(key => !['path', 'resource_uri', 'artifact_id', 'title', 'role', 'view'].includes(key))) fail();
    const refs = ['path', 'resource_uri', 'artifact_id'].filter(key => item[key] !== undefined);
    if (refs.length !== 1 || typeof item[refs[0]] !== 'string' || !item[refs[0]].trim() || item[refs[0]].length > 8192 || /[\u0000\r\n]/.test(item[refs[0]])) fail();
    if (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 256)) fail();
    if (item.role !== undefined && !['primary', 'supporting'].includes(item.role)) fail();
    if (item.view !== undefined && !['auto', 'source', 'rendered'].includes(item.view)) fail();
    if (item.role === 'primary') primary++;
    return { ...item, role: item.role || 'supporting', view: item.view || 'auto' };
  });
  if (primary > 1) fail();
  return { items, title: input.title, mode: input.mode || 'auto' };
}

export function initialPresentationState() {
  return { visible: false, activeId: 'workspace', activeOrigin: 'restore', autoFollow: true, pinnedId: null,
    userIntentVersion: 0, manualHold: false, turnId: null, seq: 0, back: [], openedIds: [], dirty: false };
}

// Pure transition: data registration is independent from reveal, activation and keyboard focus.
export function transitionPresentation(state, event) {
  if (event.type === 'turn') return event.turnId === state.turnId ? state : { ...state, turnId: event.turnId, manualHold: false };
  if (event.type === 'dirty') return { ...state, dirty: event.value };
  if (event.type === 'auto') {
    if (event.seq <= state.seq) return state;
    const next = { ...state, seq: event.seq };
    if (event.mode === 'background' || !event.foreground || !state.autoFollow || state.pinnedId || state.dirty
      || state.manualHold || event.userIntentVersion !== state.userIntentVersion || event.turnId !== state.turnId) return next;
    if (event.fallback && state.visible && !['workspace', 'results'].includes(state.activeId)) return next;
    if (state.activeId === event.id && state.visible) return next;
    return { ...next, visible: true, activeId: event.id, activeOrigin: 'auto',
      openedIds: [...new Set([...state.openedIds, event.id])].slice(-32),
      back: [...state.back, state.activeId].slice(-32) };
  }
  if (event.type === 'restore') return { ...initialPresentationState(), ...event.state, activeOrigin: 'restore', dirty: false, manualHold: true };
  const next = { ...state, userIntentVersion: state.userIntentVersion + 1, manualHold: true };
  switch (event.type) {
    case 'select': return { ...next, visible: true, activeId: event.id, activeOrigin: 'manual', pinnedId: state.activeId === event.id ? state.pinnedId : null,
      openedIds: [...new Set([...state.openedIds, event.id])].slice(-32), back: state.activeId === event.id ? state.back : [...state.back, state.activeId].slice(-32) };
    case 'close': return { ...next, visible: false };
    case 'back': return { ...next, visible: true, pinnedId: null, activeId: state.back.at(-1) || 'workspace', activeOrigin: 'manual', back: state.back.slice(0, -1) };
    case 'pin': return { ...next, pinnedId: event.value ? state.activeId : null };
    case 'follow': return { ...next, autoFollow: event.value, manualHold: !event.value, pinnedId: event.value ? null : state.pinnedId };
    case 'dismiss': return { ...next, activeId: state.activeId === event.id ? 'results' : state.activeId,
      pinnedId: state.pinnedId === event.id ? null : state.pinnedId, openedIds: state.openedIds.filter(id => id !== event.id), back: state.back.filter(id => id !== event.id) };
    default: throw new Error('Unknown presentation action');
  }
}

export const MOSS_PRESENTATION_PROMPT = `This host supports result previews for the main conversation. The main agent owns presentation; workers return output paths and verification results to it. Use moss_present for an existing main deliverable, a group of results, or a requested source/rendered view. Reuse resource references returned by tools; do not invent artifact IDs. Do not present every source edit or log. Mark at most one primary result; only that result is requested for preview. Omit primary to show a collection of files. Existing App tools can already register results: do not repeat their display call. mode=auto respects the user's selection; background only registers.
Read presentation.state in the tool result before describing display: shown/updated confirms the selected preview, not every registered item. For deferred (including user_selection), say "文件已生成，可点击链接或在结果中查看"; for pending, say "已请求预览". Never say "已打开" for pending/deferred or force focus by repeating calls. File creation, result registration and visible preview are separate outcomes.
File change counts are verified by Moss after the turn; tool calls are not a complete file inventory. Keep using the existing task tools. Link workspace files with a short filename label and an absolute Markdown target with verified line numbers, e.g. [file.ts](/absolute/file.ts:42); wrap targets containing spaces in angle brackets. Do not use the full absolute path as the visible label. Preserve App/remote resource URIs. For document citations, reuse the exact citation.displayMarkdown returned by App inspection tools. Supported document fragments are #page=2&text=URL_ENCODED_QUOTE or #sheet=URL_ENCODED_NAME&range=B12:C14. Only cite verified pages, text, and ranges; never invent locations. moss_browser_open is for manual viewing; Browser Use automation controls a separate browser.`;
