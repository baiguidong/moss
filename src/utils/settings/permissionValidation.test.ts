import { test, expect } from 'bun:test'
import { validatePermissionRule } from './permissionValidation.js'
import { SettingsSchema } from './types.js'

test('App tool permissions retain their canonical lowercase name',()=>{
  for(const name of ['app__moss_buddy__settings_apply','app__moss_buddy__*'])expect(validatePermissionRule(name).valid).toBe(true)
  expect(SettingsSchema().safeParse({permissions:{allow:['app__moss_buddy__settings_apply']},sessionMemory:{enabled:true}}).success).toBe(true)
  for(const name of ['app__moss_buddy__settings_apply(*)','app__moss_buddy__','bash'])expect(validatePermissionRule(name).valid).toBe(false)
})
