import fs from 'node:fs'
import { settingPresentation } from './moss-settings-labels.mjs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { APP_ERROR_CODES, AppServiceError } from '../../packages/app-sdk/src/errors.mjs'

const secret = /api.?key|password|secret|credential|authorization|(^|[._-])tokens?($|[._-])|(?:access|refresh|auth|bearer)Token|token$|(^|\.)(env|headers|httpHeaders|apiKeyHelper)(\.|$)/i
const unsafe = new Set(['__proto__', 'constructor', 'prototype'])
const dangerous = /(^|\.)(permissions|permissionMode|bypassPermissions|hooks|env|sandbox|apiKeyHelper|appendSystemPrompt|managedRuntimes|remote\w*|url|baseUrl|agentMode|localEnabled|agentSettings|grants|command|mcp|desktopControl)(\.|$)/i
const clone = value => value === undefined ? undefined : structuredClone(value)
export const configurationEqual = isDeepStrictEqual
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value }
export const configurationRevision = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function fail(message, code = APP_ERROR_CODES.invalidInput) { throw new AppServiceError(code, message) }
export function configurationPath(value) {
  if (typeof value !== 'string' || !value || value.length > 500) fail('无效的配置路径')
  const parts = value.split('.')
  if (parts.some(p => !p || unsafe.has(p))) fail('无效的配置路径')
  return parts
}
export function configurationValue(object, key) {
  return configurationPath(key).reduce((value, part) => value && Object.hasOwn(value, part) ? value[part] : undefined, object)
}
export function applyConfigurationChanges(value, changes) {
  const result = clone(value)
  for (const change of changes) {
    const parts = configurationPath(change.path)
    let target = result
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}
      target = target[part]
    }
    if (change.remove) delete target[parts.at(-1)]
    else target[parts.at(-1)] = clone(change.value)
  }
  return result
}
export function redactConfiguration(value) {
  if (typeof value === 'string') return value.replace(/(https?:\/\/)[^/@\s]+@/g,'$1[REDACTED]@').replace(/([?&](?:api_?key|access_token|token|password|secret)=)[^&#\s]+/gi,'$1[REDACTED]')
  if (Array.isArray(value)) return value.map(redactConfiguration)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !unsafe.has(key)).map(([key, item]) => [key, secret.test(key) ? { configured: Boolean(item), redacted: true } : redactConfiguration(item)]))
}
export function inferConfigurationSchema(value) {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferConfigurationSchema(value[0]) : {} }
  if (value === null) return {}
  if (value && typeof value === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([k,v]) => [k,inferConfigurationSchema(v)])), additionalProperties: false }
  return { type: typeof value, default: value }
}
export function configurationFields(schema, prefix = '') {
  const fields = []
  for (const [name, field] of Object.entries(schema.properties || {})) {
    const key = prefix ? `${prefix}.${name}` : name
    if (field.properties && Object.keys(field.properties).length) fields.push(...configurationFields(field, key))
    else fields.push({ key, schema: field, description: field.description || '', sensitive: secret.test(key) })
  }
  return fields
}

/** Owns receipts and concurrency. Each adapter retains its real schema, source and application semantics. */
export function createMossSettingsService({ adapters, receiptsPath, confirm = async () => false, onChanged = () => {} }) {
  let tail = Promise.resolve()
  function serialized(operation) {
    const result = tail.then(operation, operation)
    tail = result.catch(() => {})
    return result
  }
  function receipts() {
    try { return JSON.parse(fs.readFileSync(receiptsPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  function save(receipt) {
    const all = [...receipts().filter(r => r.public.receiptId !== receipt.public.receiptId), receipt].slice(-500)
    fs.mkdirSync(path.dirname(receiptsPath), { recursive: true })
    const temp = `${receiptsPath}.${randomUUID()}.tmp`
    try { fs.writeFileSync(temp, JSON.stringify(all), {mode:0o600,flush:true}); fs.renameSync(temp, receiptsPath) }
    finally { fs.rmSync(temp, {force:true}) }
  }
  const identity = context => `${context.owner?.key || 'local'}:${context.appId || 'desktop'}`
  const select = input => {
    const adapter = adapters[input.domain]
    if (!adapter) fail(`没有找到这项设置：${input.domain}`)
    return adapter
  }
  async function rawRead(input, context) {
    const adapter = select(input)
    const target = await adapter.resolve(input, context)
    const state = await adapter.read(target, context)
    return { adapter, target, state: { ...state, revision: state.revision || configurationRevision(state.values) } }
  }
  async function apply(input, context, undo = null) {
    context.assertCurrent?.(); context.signal?.throwIfAborted()
    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 50) fail('每次修改 1–50 个配置项')
    if (typeof input.requestId !== 'string' || !input.requestId.trim()) fail('缺少请求 ID')
    const unrestricted = input.approvalMode === 'unrestricted'
    if (unrestricted && !context.grants?.includes('settings:write:unrestricted')) fail('App 未获授自动修改设置的权限', APP_ERROR_CODES.permissionDenied)
    if (unrestricted) context.assertPermission?.('settings:write:unrestricted')
    const owner = identity(context)
    const fingerprint = configurationRevision({ ...input, preview: false })
    const duplicate = receipts().find(r => r.owner === owner && r.requestId === input.requestId)
    if (duplicate && !input.preview) {
      if (duplicate.fingerprint !== fingerprint) fail('同一个请求 ID 不能用于不同配置变更', APP_ERROR_CODES.conflict)
      if (duplicate.phase === 'prepared') {
        const {state} = await rawRead(duplicate.target,context)
        if (!duplicate.expected.every(c => configurationEqual(configurationValue(state.values,c.path),c.remove ? undefined : c.value))) fail('上次修改被中断，请重新读取当前配置；回执已保留',APP_ERROR_CODES.conflict)
        duplicate.phase = 'complete'
        duplicate.public = {...duplicate.public,status:'saved',message:'已核对中断前的修改结果。',revision:state.revision}
        save(duplicate)
      }
      return duplicate.public
    }
    const { adapter, target, state } = await rawRead(input, context)
    if (!adapter.apply) fail('该配置只读，请在来源处修改', APP_ERROR_CODES.permissionDenied)
    if (state.revision !== input.revision) fail('配置已被修改，请重新读取', APP_ERROR_CODES.conflict)
    const seen = new Set()
    for (const change of input.changes) {
      configurationPath(change.path)
      if (seen.has(change.path) || [...seen].some(p => p.startsWith(change.path+'.') || change.path.startsWith(p+'.'))) fail('同次修改包含重复或重叠路径')
      seen.add(change.path)
      if (secret.test(change.path)) fail('密钥请通过对应的凭据设置页面修改', APP_ERROR_CODES.permissionDenied)
      const before = configurationValue(state.values,change.path)
      if (JSON.stringify(redactConfiguration(before)) !== JSON.stringify(before)) fail('请修改具体的非敏感字段，不要替换含凭据的整个配置对象',APP_ERROR_CODES.permissionDenied)
      if (!change.remove && !Object.hasOwn(change, 'value')) fail('修改配置必须提供 value')
      if (JSON.stringify(redactConfiguration({ [change.path]: change.value })) !== JSON.stringify({ [change.path]: change.value })) fail('变更包含敏感字段，请通过凭据设置页面修改', APP_ERROR_CODES.permissionDenied)
    }
    const next = applyConfigurationChanges(state.values, input.changes)
    await adapter.validate?.(next, input.changes, target, context)
    const diff = input.changes.map(c => ({ path:c.path, before:clone(configurationValue(state.values,c.path)), ...(c.remove ? {remove:true} : {after:clone(c.value)}) }))
    const sensitive = input.changes.some(c => dangerous.test(c.path)) || adapter.confirm === true
    if (input.preview) return { preview: true, domain: input.domain, scope: target.scope, target: target.id, revision: state.revision, changes: redactConfiguration(diff), requiresConfirmation: sensitive && !unrestricted }
    if (sensitive && !unrestricted && !await confirm({ domain:input.domain, target, changes:redactConfiguration(diff) }, context)) fail('配置修改已取消', APP_ERROR_CODES.actionCanceled)
    context.assertCurrent?.(); context.signal?.throwIfAborted()
    const fresh = await adapter.read(target, context)
    if ((fresh.revision || configurationRevision(fresh.values)) !== state.revision) fail('确认期间配置发生变化，请重新读取', APP_ERROR_CODES.conflict)
    if (unrestricted) context.assertPermission?.('settings:write:unrestricted')
    const receiptId = randomUUID()
    const receipt = { owner, requestId:input.requestId, fingerprint, phase:'prepared', public:{receiptId,domain:input.domain,scope:target.scope,target:target.id,changes:redactConfiguration(diff)}, at:Date.now(), target:{domain:input.domain,scope:target.scope,target:target.id}, inverse:diff.map(c => c.before === undefined ? {path:c.path,remove:true} : {path:c.path,value:c.before}), expected:input.changes, undoOf:undo }
    // Record intent before mutating another store; a process restart can reconcile
    // the outcome without silently applying a duplicate operation.
    save(receipt)
    const result = await adapter.apply(next, input.changes, target, state.revision, context)
    const after = await adapter.read(target, context)
    const output = { ...receipt.public, status:result?.status || 'saved', message:result?.message || '配置已保存。', revision:after.revision || configurationRevision(after.values) }
    if (!input.changes.every(c => configurationEqual(configurationValue(after.values,c.path),c.remove ? undefined : c.value))) fail('保存后的值与请求不一致，请重新读取配置；修改回执已保留',APP_ERROR_CODES.conflict)
    save({...receipt,phase:'complete',public:output})
    onChanged(output)
    return output
  }
  return {
    handle(method, input = {}, context = {}) {
      if (method === 'catalog') return (async () => {
        const domains = []
        for (const [id, adapter] of Object.entries(adapters)) {
          if (input.domain && input.domain !== id) continue
          const schema = await adapter.schema?.(input, context) || {type:'object'}
          const fields = configurationFields(schema).map(f => settingPresentation(id,f)).filter(f => !input.query || `${f.key} ${f.label} ${f.group} ${f.description}`.toLowerCase().includes(input.query.toLowerCase()))
          domains.push({ id, title:adapter.title, scopes:adapter.scopes, targets:await adapter.targets?.(context) || [], writable:Boolean(adapter.apply), fields })
        }
        return { domains }
      })()
      if (method === 'read') return rawRead(input, context).then(({target,state}) => {
        const values = input.key ? { [input.key]: configurationValue(state.values,input.key) } : state.values
        const selected = input.key ? { revision:state.revision, values, effective:{[input.key]:configurationValue(state.effective || state.values,input.key)}, sources:state.sources?.map(s=>({...s,settings:{[input.key]:configurationValue(s.settings,input.key)}})) } : {...state,values}
        return redactConfiguration({domain:input.domain, scope:target.scope, target:target.id, ...selected})
      })
      if (method === 'apply') return serialized(() => apply(input,context))
      if (method === 'undo') return serialized(async () => {
        const duplicate = receipts().find(r => r.owner === identity(context) && r.requestId === input.requestId)
        if (duplicate?.undoOf !== undefined && duplicate) {
          if (duplicate.undoOf !== input.receiptId) fail('请求 ID 已被使用',APP_ERROR_CODES.conflict)
          if (duplicate.phase === 'complete') return duplicate.public
        }
        const receipt = receipts().find(r => r.public.receiptId === input.receiptId && r.owner === identity(context))
        if (!receipt) fail('配置回执不存在',APP_ERROR_CODES.notFound)
        const {state} = await rawRead(receipt.target,context)
        for (const c of receipt.expected) if (!configurationEqual(configurationValue(state.values,c.path),c.remove ? undefined : c.value)) fail('该设置后来又被修改，不能覆盖新的值',APP_ERROR_CODES.conflict)
        return apply({...receipt.target,revision:state.revision,requestId:input.requestId,approvalMode:input.approvalMode,changes:receipt.inverse},context,input.receiptId)
      })
      fail(`未知配置操作：${method}`)
    },
  }
}
