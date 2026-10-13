// Export legacy public protocol DTOs at build time. Runtime never loads TypeScript.
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as account from '../src/account/index.mjs'
import * as agent from '../src/agent/index.mjs'
import * as openim from '../src/openim/index.mjs'
const sourcePath = fileURLToPath(new URL('../src/index.d.mts', import.meta.url))
const program = ts.createProgram([sourcePath], { strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext })
const checker = program.getTypeChecker(), source = program.getSourceFile(sourcePath)
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source))
function schema(type, depth = 0) {
  if (depth > 20) return {}
  const flags = type.flags
  if (flags & ts.TypeFlags.StringLiteral) return { const: type.value }
  if (flags & ts.TypeFlags.NumberLiteral) return { const: type.value }
  if (flags & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === 'true' }
  if (flags & ts.TypeFlags.Null) return { type: 'null' }
  if (type.isUnion()) {
    const types = type.types.filter(item => !(item.flags & ts.TypeFlags.Undefined)).map(item => schema(item, depth + 1))
    return types.length === 1 ? types[0] : { anyOf: types }
  }
  if (flags & ts.TypeFlags.String) return { type: 'string' }
  if (flags & ts.TypeFlags.Number) return { type: 'number' }
  if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' }
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  if (checker.isArrayType(type)) return { type: 'array', items: schema(checker.getTypeArguments(type)[0], depth + 1) }
  const properties = {}, required = []
  for (const member of checker.getPropertiesOfType(type)) {
    properties[member.name] = schema(checker.getTypeOfSymbolAtLocation(member, member.valueDeclaration || member.declarations?.[0] || source), depth + 1)
    if (!(member.flags & ts.SymbolFlags.Optional)) required.push(member.name)
  }
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  return { type: 'object', properties, required, additionalProperties: index ? schema(index, depth + 1) : false }
}
function map(name) {
  const symbol = exports.find(item => item.name === name)
  if (!symbol) throw new Error(`Missing public DTO: ${name}`)
  return schema(checker.getDeclaredTypeOfSymbol(symbol)).properties
}
const protocols = {}
for (const [module, prefix, protocol] of [[account, 'Account', 'moss.account/v1'], [agent, 'Agent', 'moss.agent/v1'], [openim, 'OpenIM', 'moss.openim/v1']]) {
  const permissions = module[`${prefix.toUpperCase()}_HOST_METHOD_PERMISSIONS`]
  const inputs = map(`${prefix}HostRequestMap`), outputs = map(`${prefix}HostResultMap`)
  protocols[protocol] = { methods: Object.fromEntries(Object.entries(permissions).map(([name, permission]) => [name, {
    permission, surfaces: ['ui', 'backend'], input: inputs[name], output: outputs[name],
    errors: ['APP_INVALID_ACTION_INPUT', 'APP_PERMISSION_DENIED', 'APP_HOST_UNAVAILABLE', 'APP_HOST_PROTOCOL_ERROR'],
  }])), events: {} }
  if (prefix === 'Account') for (const [name, permission] of Object.entries(account.ACCOUNT_BACKEND_EVENT_PERMISSIONS)) protocols[protocol].events[name] = { permission, input: map('AccountBackendEventMap')[name] }
  if (prefix === 'Agent') for (const [name, permission] of Object.entries(agent.AGENT_BACKEND_EVENT_PERMISSIONS)) protocols[protocol].events[name] = { permission, input: { type: 'object', required: name === 'binding.changed' ? ['externalConversationId', 'revision'] : ['externalConversationId', 'turnId'], properties: { externalConversationId: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 0 }, turnId: { type: 'string', minLength: 1 } }, additionalProperties: true } }
}
const output = JSON.stringify(protocols, null, 2) + '\n'
const destination = new URL('../src/host/public-contracts.json', import.meta.url)
if (process.argv.includes('--check')) { if (await fs.readFile(destination, 'utf8') !== output) throw new Error('Stale public SDK contracts') }
else await fs.writeFile(destination, output)
