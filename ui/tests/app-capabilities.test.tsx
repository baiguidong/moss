import {test,expect} from 'bun:test';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {appCapabilitySummary} from '../src/renderer-react/lib/app-capabilities';
import {AppAgentTools} from '../src/renderer-react/components/app-capabilities';
import {AppToolSettingsTable} from '../src/renderer-react/components/settings-view';
import type {StoredApp,AppMcpServiceTools} from '../src/renderer-react/types';
const base={id:'test.app',name:'test.app',displayName:'测试 App',enabled:true,toolScope:'session'} as StoredApp;
const service={appId:'test.app',instanceId:'default',name:'upstream',revision:'one',runtimeName:'test',status:'connected',tools:[{name:'index',description:'索引',disabled:false},{name:'query',description:'查询',disabled:true}]} as AppMcpServiceTools;
test('capability counts combine native and MCP tools and separately name CLI skills',()=>{
 const app={...base,agentTools:[{id:'local',title:'本地操作',description:'读取',effect:'read' as const}],mcpServices:[service],contributes:{skills:[{id:'cli',title:'命令行入口',description:'执行上游',path:'skill.md',cli:'cli.mjs'}]}};
 expect(appCapabilitySummary(app)).toBe('3 个 AI 工具 · 1 个 CLI skill');
 const markup=renderToStaticMarkup(<AppAgentTools app={app}/>);
 expect(markup).toContain('命令行入口');expect(markup).toContain('index');expect(markup).toContain('query');expect(markup).toContain('本地操作');
});
test('undiscovered MCP services never masquerade as zero tools',()=>{
 expect(appCapabilitySummary({...base,mcpServices:[{...service,status:'unchecked',tools:[]}]})).toBe('MCP 工具待发现');
 expect(appCapabilitySummary({...base,mcpServices:[{...service,truncated:true}]})).toBe('至少 2 个 AI 工具 · MCP 工具待发现');
 expect(appCapabilitySummary({...base,mcpServices:[{...service,tools:[]}]})).toBe('暂无 AI 工具');
 expect(appCapabilitySummary({...base,mcpServices:[{...service,status:'failed',tools:[]}]})).toBe('MCP 工具加载失败');
 expect(appCapabilitySummary({...base,mcpServices:[{...service,status:'unauthorized',tools:[]}]})).toBe('MCP 工具待授权');
});
test('CLI-only Apps remain visible in the global capability table',()=>{
 const app={...base,contributes:{skills:[{id:'cli',title:'Pandoc 转换',description:'操作本地文档',path:'skill.md',cli:'cli.mjs'}]}};
 const markup=renderToStaticMarkup(<AppToolSettingsTable apps={[app]}/>);
 expect(markup).toContain('Pandoc 转换');expect(markup).toContain('CLI skill');expect(markup).not.toContain('暂未提供 AI 工具');
});
