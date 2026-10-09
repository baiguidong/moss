import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAppComposer } from '../src/apps/app-composer.mjs'

test('ordinary composer uses attested workspace, bounded resources and only owning App tools', async () => {
  const calls = []
  const provider = { id:'example/flows', appId:'example', title:'工作流', listAction:'list', resolveAction:'resolve' }
  const runtime = {
    listContributions: async ({kinds}) => kinds[0] === 'tools' ? {tools:[{localId:'read',name:'app__example__read'}]} : {resourceProviders:[provider]},
    requireContribution: async (_, id) => { assert.equal(id,provider.id); return provider },
    resolveContributionInstance: () => ({id:'default'}),
    invoke: async (app, instance, action, input, options) => { calls.push({app,action,input,options}); return action==='list' ? [{title:'测试',ref:{id:'one'},route:'javascript:bad'}] : {title:'测试',instruction:'read selected resource',tools:['read','foreign'],route:'#/flow/one'} },
  }
  const composer = createAppComposer({getRuntime:()=>runtime,getSession:()=>({id:'session',workspace:'/trusted',agentMode:'local'})})
  assert.equal((await composer.list({workspace:'/draft'})).items[0].route,'')
  assert.equal(calls[0].options.invocation.workspace,'/draft')
  const resolved = await composer.resolve({providerId:provider.id,intent:'use',ref:{id:'one'}},{sessionId:'session',workspace:'/spoof'})
  assert.equal(calls[1].options.invocation.workspace,'/trusted')
  assert.deepEqual(resolved.tools,['app__example__read'])
  assert.equal(calls.length,2) // no session creation or execution while preparing
  await assert.rejects(()=>composer.resolve({providerId:provider.id,intent:'execute'}), /无效/)
})
