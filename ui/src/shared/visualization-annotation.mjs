import { isAppResourceUri } from './app-resource-uri.mjs'

export function normalizeVisualizationSelection(value) {
  if (!value || !['element', 'text', 'region'].includes(value.kind)) throw new Error('请选择需要修改的内容')
  const text = (name, limit) => {
    if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length > limit)) throw new Error('标注内容超出限制')
    return value[name] || ''
  }
  if (value.pageNumber !== undefined && (!Number.isInteger(value.pageNumber) || value.pageNumber < 1 || value.pageNumber > 100000)) throw new Error('标注页码无效')
  const rect = value.rect
  if (!rect || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(rect[key]) || rect[key] < 0 || rect[key] > 1e7)
    || rect.width <= 0 || rect.height <= 0) throw new Error('标注区域无效')
  return { kind: value.kind, ...(value.pageNumber !== undefined ? { pageNumber: value.pageNumber } : {}), selector: text('selector', 1000), text: text('text', 2000), nearbyText: text('nearbyText', 2000),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
}

export function normalizeVisualizationAnnotation(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || typeof value.resourceUri !== 'string' || value.resourceUri.length > 4096 || !isAppResourceUri(value.resourceUri)
    || typeof value.comment !== 'string' || !value.comment.trim() || value.comment.length > 4000) throw new Error('可视化标注无效')
  const state = JSON.stringify(value.state ?? null)
  if (new TextEncoder().encode(state).length > 16384) throw new Error('交互状态超过 16 KiB')
  return { id: value.id, resourceUri: value.resourceUri, comment: value.comment.trim(), selection: normalizeVisualizationSelection(value.selection), state: JSON.parse(state) }
}
