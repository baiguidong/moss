// Raw contribution/service identities, never model-facing aliases. No Manifest defaults.
export function toolCallPolicyKey(identity) {
  const fields = identity?.kind === 'app' ? ['contributionId']
    : identity?.kind === 'mcp' ? ['instanceId', 'server', 'toolName'] : null
  if (!fields || fields.some(key => typeof identity[key] !== 'string' || !identity[key] || identity[key].length > 500)) throw new Error('工具标识不完整。')
  return JSON.stringify([identity.kind, ...fields.map(key => identity[key])])
}
