import readline from 'node:readline'
import fs from 'node:fs'
let value = ''
if (process.env.MCP_TEST_PID_LOG) fs.appendFileSync(process.env.MCP_TEST_PID_LOG, `${process.pid}\n`)
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.id === undefined) continue
  let result
  if (message.method === 'initialize') {
    if (process.env.MCP_TEST_HANDSHAKE_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.MCP_TEST_HANDSHAKE_DELAY)))
    result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, ...(process.env.MCP_TEST_RESOURCES ? { resources: {} } : {}) }, serverInfo: { name: 'stateful-fixture', version: '1.0.0' } }
  } else if (message.method === 'tools/list') result = { tools: [
    { name: 'set_value', description: 'Set session value', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
    { name: 'get_value', description: 'Read session value', inputSchema: { type: 'object', properties: {} } },
  ] }
  else if (message.method === 'tools/call') {
    if (process.env.MCP_TEST_TOOL_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.MCP_TEST_TOOL_DELAY)))
    if (message.params.name === 'set_value') value = message.params.arguments.value
    result = { content: [{ type: 'text', text: JSON.stringify({ value, pid: process.pid, cwd: process.cwd() }) }] }
  } else if (message.method === 'resources/list') result = { resources: [] }
  else result = {}
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
}
