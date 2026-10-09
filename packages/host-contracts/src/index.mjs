import { localContracts } from './local.mjs'
import { cloudContracts } from './cloud.mjs'
import { hostContracts } from './host.mjs'
export { platformLimits } from './local.mjs'
import { executionContracts } from './execution.mjs'
import { mcpContracts } from './mcp.mjs'
export { executionLimits } from './execution.mjs'
export { mcpLimits } from './mcp.mjs'
export const contracts = { ...executionContracts, ...mcpContracts, ...localContracts, ...cloudContracts, ...hostContracts }
