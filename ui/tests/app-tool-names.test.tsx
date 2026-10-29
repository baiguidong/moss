import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import builtins from '../../packages/app-sdk/src/builtin-apps.json'
import { normalizeAppToolName } from '../../packages/app-sdk/src/tool-names.mjs'
import { collectManifestContributions } from '../../packages/app-runtime/src/contributions/index.mjs'
import { describeAppTools } from '../src/apps/app-tool-disclosure.mjs'
import { AppDetailsTools } from '../src/renderer-react/components/app-details-tools'
import type { StoredApp } from '../src/renderer-react/types'

test('each external App supplies its own prefix across registration and disclosure', () => {
  for (const [appId, name] of [['moss.qq-mail', 'qqmail_SendMessage'], ['example.calendar', 'calendar_SendMessage']]) {
    const manifest = { id: appId, displayName: '本地化显示名称', contributes: { tools: [{ id: 'SendMessage' }] } }
    expect(collectManifestContributions(manifest).tools[0].name).toBe(name)
    expect(describeAppTools(manifest)[0].name).toBe(name)
    expect(normalizeAppToolName('SendMessage', appId!)).toBe(name!)
  }
})

test('the bundled App selection is also the complete prefix exemption list', () => {
  for (const appId of builtins.apps) {
    const manifest = { id: appId, contributes: { tools: [{ id: 'create' }] } }
    expect(collectManifestContributions(manifest).tools[0].name).toBe('create')
    expect(describeAppTools(manifest)[0].name).toBe('create')
    expect(normalizeAppToolName('create', appId)).toBe('create')
  }
  expect(normalizeAppToolName('create', 'moss.external')).toBe('external_create')
})

test('long names are valid and stable without losing distinguishing suffixes', () => {
  const appId = `example.${'a'.repeat(65)}`
  const names = ['one', 'two'].map(id => normalizeAppToolName(id, appId))
  expect(names[0]).not.toBe(names[1])
  expect(normalizeAppToolName('one', appId)).toBe(names[0]!)
  for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]{64}$/)
})

test('MCP tool details display the same names as model registration', () => {
  for (const [appId, expected] of [['moss.qq-mail', 'qqmail_SendMessage'], ['moss.spreadsheets', 'SendMessage']]) {
    const app = { id: appId, name: appId, displayName: 'App', enabled: true } as StoredApp
    const html = renderToStaticMarkup(<AppDetailsTools app={app} mcpTools={[{ name: 'SendMessage', server: 'mail' }]} />)
    expect(html).toContain(`data-app-tool="${expected}"`)
  }
})
