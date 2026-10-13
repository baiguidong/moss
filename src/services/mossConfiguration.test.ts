import { test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectMossAgentConfiguration, applyMossAgentConfiguration, getMossAgentConfigurationSchema } from './mossConfiguration.js'

test('configuration schema is generated from the runtime and project writes preserve unrelated keys',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'moss-config-runtime-'))
  const previous=process.env.MOSS_CONFIG_DIR;process.env.MOSS_CONFIG_DIR=path.join(root,'user')
  try {
    const first=path.join(root,'one'),second=path.join(root,'two')
    for(const p of [first,second]){fs.mkdirSync(path.join(p,'.moss'),{recursive:true});fs.writeFileSync(path.join(p,'.moss/settings.json'),JSON.stringify({language:'chinese',attribution:{commit:'old',pr:'keep'},customDesktop:{preserve:true}}))}
    expect(getMossAgentConfigurationSchema().properties).toHaveProperty('hooks')
    let snapshot=inspectMossAgentConfiguration(first,'project')
    const initial=snapshot.revision
    snapshot=applyMossAgentConfiguration({workspace:first,scope:'project',revision:snapshot.revision,operations:[{path:'attribution',value:{commit:'new'}}]})
    expect(snapshot.stored.attribution).toEqual({commit:'new'})
    expect(snapshot.stored.customDesktop).toEqual({preserve:true})
    expect(inspectMossAgentConfiguration(second,'project').stored.attribution).toEqual({commit:'old',pr:'keep'})
    expect(()=>applyMossAgentConfiguration({workspace:first,scope:'project',revision:initial,operations:[{path:'language',value:'japanese'}]})).toThrow('changed')
    snapshot=applyMossAgentConfiguration({workspace:first,scope:'project',revision:snapshot.revision,operations:[{path:'attribution.commit',remove:true}]})
    expect(snapshot.stored.attribution).toEqual({})
    for(const operation of [{path:'language',value:12},{path:'doesNotExist',value:1},{path:'__proto__.polluted',value:true}])expect(()=>applyMossAgentConfiguration({workspace:first,scope:'project',revision:snapshot.revision,operations:[operation]})).toThrow()
    expect(inspectMossAgentConfiguration(first,'project').revision).toBe(snapshot.revision)
  } finally { if(previous===undefined)delete process.env.MOSS_CONFIG_DIR;else process.env.MOSS_CONFIG_DIR=previous;fs.rmSync(root,{recursive:true,force:true}) }
})
