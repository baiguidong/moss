import {test,expect} from 'bun:test'
import {assertWorkflowPolicy} from './policy'
test('legacy mandatory workflow policy cannot be overridden by App settings',()=>{
 for(const env of [{MOSS_DISABLE_WORKFLOWS:'true'},{CLAUDE_CODE_DISABLE_WORKFLOWS:'1'}])expect(()=>assertWorkflowPolicy(env,{})).toThrow('环境变量')
 for(const policy of [{disableWorkflows:true},{enableWorkflows:false}])expect(()=>assertWorkflowPolicy({},policy)).toThrow('托管策略')
 expect(()=>assertWorkflowPolicy({MOSS_DISABLE_WORKFLOWS:'false'},{enableWorkflows:true})).not.toThrow()
})
