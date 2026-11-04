import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isToolSourceAvailable } from '../../../packages/app-sdk/src/tool-services.mjs';
import { canInvokeSessionAppTool } from './session-apps.mjs';

/** Resolve identities using Host state, never renderer-provided executable destinations. */
export function createAppToolCallReviewer({ getRuntime, getMcpHost, drafts }) {
  return async function review(event, session) {
    if (session?.agentMode === 'remote-direct' || !session?.id || session.deleted || typeof event.execute !== 'function' || !event.signal?.throwIfAborted) throw new Error('工具草稿只支持当前 Moss 会话的调用。');
    const runtime = getRuntime(), input = event.input;
    if (!runtime) throw new Error('App Runtime 尚未就绪。');
    const policyScope = runtime.storageAppId(input.appId);
    if (input.kind === 'app' && runtime.toolCallPolicies.get(policyScope, { kind: 'app', contributionId: input.contributionId }) !== 'draft') return event.execute(input.arguments, false);
    if (input.kind === 'mcp' && !Object.keys(runtime.toolCallPolicies.list(policyScope)).some(key => {
      const identity = JSON.parse(key); return identity[0] === 'mcp' && identity[3] === input.toolName;
    })) return event.execute(input.arguments, false);
    const owner = runtime.currentOwner().key;
    async function resolve() {
      event.signal.throwIfAborted();
      if (session.deleted || runtime.currentOwner().key !== owner) throw new Error('会话或账号已变化，请重新发起工具调用。');
      const installation = runtime.getInstallation(input.appId);
      if (!installation?.enabled) throw new Error('App 已停用或移除。');
      let identity, schema, binding, title;
      if (input.kind === 'app') {
        const contribution = await runtime.requireContribution('tools', input.contributionId, { loadSchemas: true });
        if (contribution.appId !== input.appId || !canInvokeSessionAppTool(session, contribution)) throw new Error('此工具不在当前会话中。');
        identity = { kind: 'app', contributionId: contribution.id };
        schema = contribution.inputSchemaDocument; binding = contribution; title = contribution.title || input.toolName;
      } else if (input.kind === 'mcp') {
        const host = getMcpHost(), server = host?.findServer(input.serverName);
        if (!server || server.provider.appId !== input.appId) throw new Error('MCP 服务已变化或不可用。');
        const source = host.owner(server.provider, server);
        if (!server.enabled || server.config.disabledTools?.includes(input.toolName)
          || !isToolSourceAvailable(source, session.appIds, session.appServiceIds)) throw new Error('MCP 工具已停用或移出当前会话。');
        const catalog = host.toolCatalog(input.appId).find(s => s.instanceId === server.provider.instanceId && s.name === server.localName);
        const tool = catalog?.tools.find(t => t.name === input.toolName);
        if (tool?.disabled) throw new Error('MCP 工具已排除。');
        schema = tool?.inputSchema || input.schema;
        identity = { kind: 'mcp', instanceId: server.provider.instanceId, server: server.localName, serviceId: source.serviceId, toolName: input.toolName };
        binding = { serviceRevision: catalog?.revision, config: server.config, tool: tool || { name: input.toolName, inputSchema: input.schema } };
        title = input.toolName;
      } else throw new Error('未知工具来源。');
      if (!schema || !isDeepStrictEqual(schema, input.schema)) throw new Error('工具参数定义已变化，请重新发起调用。');
      // Account/instance settings can change without an App version change. Only
      // their digest enters the draft; credentials never enter renderer data.
      const instances = await Promise.all((runtime.instances?.list(input.appId) || []).map(async instance => ({
        id: instance.id, incarnationId: instance.incarnationId, enabled: instance.enabled, config: instance.config,
        updatedAt: instance.updatedAt, credentials: await runtime.credentials?.get(input.appId, instance.id),
      })));
      const sourceRevision = createHash('sha256').update(JSON.stringify({ version: installation.activeVersion, grants: installation.grants, binding, instances })).digest('hex');
      return { identity, schema, sourceRevision, title, appVersion: installation.activeVersion };
    }
    const initial = await resolve();
    if (!initial || runtime.toolCallPolicies.get(runtime.storageAppId(input.appId), initial.identity) !== 'draft') return event.execute(input.arguments, false);
    return drafts.intercept({ ...initial, identity: { ...initial.identity, sourceRevision: initial.sourceRevision }, appId: input.appId,
      title: initial.title, sessionId: session.id, toolUseId: input.toolUseId, args: input.arguments,
      execute: event.execute, signal: event.signal, validateCurrent: async () => {
        const current = await resolve();
        if (current?.sourceRevision !== initial.sourceRevision) throw new Error('App、工具、账号或服务配置已变化，请重新生成草稿。');
      } });
  };
}
