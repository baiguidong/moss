// Build with bun run build:electron-direct; uses a local model fixture only.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCoordinatorStressFixture, bounded } from './helpers/coordinator-stress-fixture.mjs'

const report = process.stdout.write.bind(process.stdout)
const fixture = await createCoordinatorStressFixture()
const descriptor = (appId, name, description) => ({
  id: `${appId}/${name}`, appId, name, title: name, description,
  effect: 'read', toolScope: 'global', toolLoading: 'always', inputSchemaDocument: { type: 'object', properties: {} },
})
try {
  await mkdir(path.join(fixture.root, 'profile', 'memory'), { recursive: true })
  await writeFile(path.join(fixture.root, 'profile', 'memory', 'MEMORY.md'), 'GLOBAL_MEMORY_SENTINEL')
  await writeFile(path.join(fixture.root, 'AGENTS.md'), 'GLOBAL_INSTRUCTIONS_SENTINEL')
  const skillRoot = path.join(fixture.root, 'foreign-skills', '.moss', 'skills')
  for (let i = 0; i < 198; i++) {
    const directory = path.join(skillRoot, `foreign-skill-${i}`)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'SKILL.md'), `---\nname: foreign-skill-${i}\ndescription: FOREIGN_SKILL_SENTINEL\n---\nForeign plugin instructions.\n`)
  }
  const foreign = Array.from({ length: 102 }, (_, i) => descriptor(`foreign-${i}`, `foreign_tool_${i}`, 'FOREIGN_TOOL_SENTINEL '.repeat(100)))
  const appTools = [descriptor('moss.buddy', 'settings_read', 'Read Moss settings'), ...foreign]
  const item = await fixture.scenario('buddy', 0, async ({ run }) => run === 1
    ? { blocks: [{ type: 'tool_use', name: 'ToolSearch', input: { query: 'foreign_tool_0', max_results: 1 } }] }
    : {}, {
    coordinatorMode: false,
    appendSystemPrompt: 'BUDDY_CUSTOM_PROMPT',
    appTools,
    appToolPolicy: { appIds: ['moss.buddy', ...foreign.map(t => t.appId)], isolatedAppId: 'moss.buddy', mcpServers: {} },
    // Simulate stale or accidentally assembled resources, not just an empty config.
    mcpServers: { foreign: { type: 'http', url: 'http://127.0.0.1:1/should-not-connect' } },
    addDirs: [path.dirname(path.dirname(skillRoot))],
    allowedTools: ['settings_read', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'CronCreate', 'CronDelete', 'CronList', 'AskUserQuestion', 'ToolSearch'],
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: true, extractionEnabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
  })
  await bounded(item.send().done, 'isolated Buddy first turn')
  assert.ok(item.state.workerRequests.length >= 2, 'ToolSearch continuation must be exercised')
  await item.restart()
  await bounded(item.send('STRESS_CASE:buddy continue').done, 'isolated Buddy resume')
  for (const { body } of item.state.workerRequests) {
    const names = body.tools.map(t => t.name)
    assert.ok(names.includes('settings_read'))
    assert.ok(names.includes('Bash'))
    assert.ok(!names.some(name => name === 'Skill' || name === 'Agent' || name.startsWith('foreign') || name.startsWith('mcp__')))
    assert.match(JSON.stringify(body.system), /BUDDY_CUSTOM_PROMPT/)
    assert.doesNotMatch(JSON.stringify(body), /FOREIGN_TOOL_SENTINEL|FOREIGN_SKILL_SENTINEL|foreign-skill-|GLOBAL_MEMORY_SENTINEL|GLOBAL_INSTRUCTIONS_SENTINEL|# auto memory/)
    assert.ok(JSON.stringify(body).length < 100_000, 'first prompt must not grow with installed resources')
  }
  const ordinary = await fixture.scenario('ordinary', 0, async () => ({}), {
    environment: { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: true, extractionEnabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
    coordinatorMode: false, appTools, addDirs: [path.dirname(path.dirname(skillRoot))],
    appToolPolicy: { appIds: [], mcpServers: {} },
  })
  await bounded(ordinary.send().done, 'ordinary resident tools')
  assert.ok(ordinary.state.workerRequests[0].body.tools.some(t => t.name === 'foreign_tool_0'))
  assert.match(JSON.stringify(ordinary.state.workerRequests[0].body), /foreign-skill-/)
  assert.ok(JSON.stringify(ordinary.state.workerRequests[0].body).includes('GLOBAL_MEMORY_SENTINEL'), 'ordinary session retains global memory')
  assert.ok(JSON.stringify(ordinary.state.workerRequests[0].body).includes('GLOBAL_INSTRUCTIONS_SENTINEL'), 'ordinary session retains project instructions')
  assert.deepEqual(fixture.errors, [])
  report(`PASS: Buddy first turn, ToolSearch and resume excluded 102 foreign tools and 198 skills; ordinary resident tools retained. Buddy requests: ${item.state.workerRequests.length}; first request tools: ${item.state.workerRequests[0].body.tools.length}, bytes: ${Buffer.byteLength(JSON.stringify(item.state.workerRequests[0].body))}.\n`)
} catch (error) {
  report(String(error.stack || error) + '\n')
  process.exitCode = 1
} finally {
  await fixture.close()
}
