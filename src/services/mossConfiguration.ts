import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { toJSONSchema } from 'zod/v4'
import { SettingsSchema } from '../utils/settings/types.js'
import { getSettingsWithSources, getSettingsFilePathForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { runWithCwdOverride } from '../utils/cwd.js'
import { DEFAULT_GLOBAL_CONFIG, saveGlobalConfig } from '../utils/config.js'
import { getGlobalMossFile } from '../utils/env.js'
import { SUPPORTED_SETTINGS } from '../tools/ConfigTool/supportedSettings.js'

const sources = { user: 'userSettings', project: 'projectSettings', local: 'localSettings' } as const
type Scope = keyof typeof sources
type Operation = { path: string; value?: unknown; remove?: boolean }
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const globalFields = Object.entries(SUPPORTED_SETTINGS).filter(([,setting]) => setting.source === 'global')
export function getMossPreferencesSchema() {
  return { type:'object', additionalProperties:false, properties:Object.fromEntries(globalFields.map(([key,setting]) => [key,{type:setting.type,description:setting.description,...(setting.options?{enum:[...setting.options]}:{})}])) }
}
function publicPreferences(value: Record<string,unknown>) { return Object.fromEntries(globalFields.map(([key])=>[key,value[key]])) }
export function inspectMossPreferences() {
  const file=getGlobalMossFile(),content=fileContent(file)
  const stored=content?JSON.parse(content):{}
  return {values:publicPreferences({...DEFAULT_GLOBAL_CONFIG,...stored}),revision:digest(content),path:file}
}
export function applyMossPreferences(input: {revision:string;changes:Operation[]}) {
  const snapshot=inspectMossPreferences()
  if(snapshot.revision!==input.revision)throw new Error('Preferences changed; read again')
  const values={...snapshot.values}
  for(const change of input.changes){
    const setting=globalFields.find(([key])=>key===change.path)?.[1]
    if(!setting||change.remove||typeof change.value!==setting.type||(setting.options&&!setting.options.includes(String(change.value))))throw new Error(`Invalid preference: ${change.path}`)
    values[change.path]=change.value
  }
  saveGlobalConfig(current=>{
    if(JSON.stringify(publicPreferences(current))!==JSON.stringify(snapshot.values))throw new Error('Preferences changed while saving')
    return {...current,...values}
  })
  return inspectMossPreferences()
}
function fileContent(file: string) {
  try { return readFileSync(file, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') return ''; throw error }
}
function parts(path: string) {
  const result = path.split('.')
  if (!result.length || result.some(p => !p || forbidden.has(p))) throw new Error('Invalid configuration path')
  return result
}
function set(object: Record<string, any>, path: string[], value: unknown) {
  let target = object
  for (const part of path.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}
    target = target[part]
  }
  if (value === undefined) delete target[path[path.length - 1]!]
  else target[path[path.length - 1]!] = value
}
export function getMossAgentConfigurationSchema() {
  return toJSONSchema(SettingsSchema(), { io: 'input', target: 'draft-7' })
}
export function inspectMossAgentConfiguration(workspace: string, scope: Scope = 'user') {
  if (!Object.hasOwn(sources, scope)) throw new Error('Unsupported configuration scope')
  return runWithCwdOverride(workspace, () => {
    const file = getSettingsFilePathForSource(sources[scope])!
    const content = fileContent(file)
    return { ...getSettingsWithSources(), scope, path: file, revision: digest(content), stored: content ? JSON.parse(content) : {} }
  })
}
export function validateMossAgentConfiguration(input: { workspace: string; scope: Scope; revision: string; operations: Operation[] }) {
  return runWithCwdOverride(input.workspace, () => {
    const snapshot = inspectMossAgentConfiguration(input.workspace, input.scope)
    if (snapshot.revision !== input.revision) throw new Error('Configuration changed; read it again before applying')
    if (!input.operations.length || input.operations.length > 50) throw new Error('Expected 1–50 configuration changes')
    const schema = SettingsSchema()
    const policy = snapshot.sources.find(s => s.source === 'policySettings')?.settings || {}
    const candidate = structuredClone(snapshot.stored)
    for (const operation of input.operations) {
      const keys = parts(operation.path)
      if (!Object.hasOwn(schema.shape, keys[0]!)) throw new Error(`Unknown Agent setting: ${keys[0]}`)
      if (Object.hasOwn(policy, keys[0]!)) throw new Error(`Setting is managed by policy: ${keys[0]}`)
      const value = operation.remove ? undefined : operation.value
      set(candidate, keys, value)
    }
    const validation = schema.safeParse(candidate)
    if (!validation.success) throw new Error(validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
    return candidate
  })
}
export function applyMossAgentConfiguration(input: { workspace: string; scope: Scope; revision: string; operations: Operation[] }) {
  return runWithCwdOverride(input.workspace, () => {
    const candidate = validateMossAgentConfiguration(input)
    // Replace the validated raw document so object replacement/removal has the
    // same semantics as the preview and unknown Desktop fields survive.
    const result = updateSettingsForSource(sources[input.scope], candidate, { replace: true })
    if (result.error) throw result.error
    return inspectMossAgentConfiguration(input.workspace, input.scope)
  })
}
