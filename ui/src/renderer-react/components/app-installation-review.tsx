import * as React from 'react';
import { Blocks, Check, ChevronDown, KeyRound, Search, Terminal, Workflow } from 'lucide-react';
import type { AppInstallationDisclosure } from '@/types';

const effectLabels: Record<string, string> = { read: '只读', write: '可修改数据', destructive: '破坏性操作' };
function Description({ text = '' }: { text?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  return <div className="install-description"><p className={expanded || text.length <= 88 ? '' : 'install-excerpt'}>{text || '暂无说明'}</p>{text.length > 88 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起说明' : '展开说明'}<ChevronDown size={12} className={expanded ? 'install-rotated' : ''}/></button>}</div>;
}
function Table({ label, columns, children }: { label: string; columns: string[]; children: React.ReactNode }) {
  return <div className="install-table-wrap"><table aria-label={label} className="install-table"><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function AppInstallationReview({ disclosure }: { disclosure: AppInstallationDisclosure }) {
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState(disclosure.tools.length ? 'tools' : disclosure.permissions.length ? 'permissions' : disclosure.skills.length ? 'skills' : 'capabilities');
  const { requires = [], provides = [], usesTools = [] } = disclosure.capabilities;
  const capabilityCount = requires.length + provides.reduce((count, item) => count + item.methods.length, 0) + usesTools.reduce((count, item) => count + item.tools.length, 0);
  const tabs = [
    { id: 'tools', label: 'AI 工具', count: disclosure.tools.length, icon: Blocks },
    { id: 'permissions', label: '新增权限', count: disclosure.permissions.length, icon: KeyRound },
    { id: 'skills', label: '技能', count: disclosure.skills.length, icon: Terminal },
    { id: 'capabilities', label: '跨 App 能力', count: capabilityCount, icon: Workflow },
  ];
  const tools = disclosure.tools.filter(tool => `${tool.title} ${tool.name || tool.id} ${tool.description}`.toLowerCase().includes(query.toLowerCase()));
  const hasCapabilities = capabilityCount > 0;
  return <div className="install-review">
    <div className="install-summary"><span className="install-app-icon"><Blocks size={24}/></span><div><strong>{disclosure.name}</strong><p>{[disclosure.version && `v${disclosure.version}`, disclosure.publisher].filter(Boolean).join(' · ') || disclosure.appId}</p></div><span className="install-summary-count">{disclosure.tools.length} 个工具<span> · {disclosure.permissions.length} 项新增权限</span></span></div>
    {disclosure.notices.map((notice, index) => <div key={index} className="install-notice">{notice}</div>)}
    <div className="install-tabs" role="tablist" aria-label="安装能力分类">{tabs.map(({ id, label, count, icon: Icon }) => <button key={id} id={`install-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`install-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!direction && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)! : tabs[(tabs.findIndex(item => item.id === id) + direction + tabs.length) % tabs.length];
      setTab(next.id); document.getElementById(`install-tab-${next.id}`)?.focus();
    }}><Icon size={15}/>{label}<span>{count}</span></button>)}</div>
    <div role="tabpanel" id={`install-panel-${tab}`} aria-labelledby={`install-tab-${tab}`} className="install-tab-panel">
      {tab === 'tools' && <>
        <p className="install-availability">{disclosure.toolAvailability}</p>
        {disclosure.tools.length > 8 && <label className="install-search"><Search size={15}/><input aria-label="搜索安装工具" placeholder="搜索工具名称或用途" value={query} onChange={event => setQuery(event.target.value)}/><span>{tools.length} / {disclosure.tools.length}</span></label>}
        {tools.length ? <Table label="AI 工具清单" columns={['工具', '用途', '操作类型']}>{tools.map(tool => <tr key={tool.id}><td><strong>{tool.title}</strong><details className="install-identifiers"><summary>调用详情</summary><dl><dt>工具名称</dt><dd><code>{tool.name || tool.id}</code></dd>{tool.serviceId && <><dt>子服务</dt><dd>{tool.serviceId}</dd></>}{tool.permission && <><dt>所需权限</dt><dd>{tool.permission}</dd></>}</dl></details></td><td><Description text={tool.description}/></td><td><span className={`install-effect install-effect-${tool.effect}`}>{tool.effect === 'read' && <Check size={12}/>} {effectLabels[tool.effect] || '未声明'}</span></td></tr>)}</Table> : <p className="install-empty">{query ? '没有匹配的工具，试试其他关键词。' : '此 App 没有声明 AI 工具。'}</p>}
      </>}
      {tab === 'permissions' && <>{disclosure.permissions.length ? <><p className="install-availability">安装时将授予以下新增权限。已授予且保留的权限不在此重复列出。</p><Table label="新增权限清单" columns={['权限', '用途']}>{disclosure.permissions.map(permission => <tr key={permission.id}><td><strong>{permission.label}</strong><code className="install-secondary-id">{permission.id}</code></td><td><Description text={permission.description}/></td></tr>)}</Table></> : <p className="install-empty"><Check size={20}/>本次安装无需新增权限。</p>}</>}
      {tab === 'skills' && <>{disclosure.skills.length ? <><p className="install-availability">以下技能为主会话提供此 App 的使用方法与工作流程。</p><Table label="技能清单" columns={['技能', '用途']}>{disclosure.skills.map(skill => <tr key={skill.id}><td><strong>{skill.title}</strong><code className="install-secondary-id">{skill.id}</code></td><td><Description text={skill.description}/></td></tr>)}</Table></> : <p className="install-empty">此 App 没有声明技能。</p>}</>}
      {tab === 'capabilities' && <>{hasCapabilities ? <>
        {requires.length > 0 && <section className="install-capability-section"><h3>调用其他 App 的能力</h3><Table label="需要的跨 App 能力" columns={['能力协议', '要求']}>{requires.map(item => <tr key={item.protocol}><td><code>{item.protocol}</code></td><td>{item.optional ? '可选' : '必需'}</td></tr>)}</Table></section>}
        {usesTools.length > 0 && <section className="install-capability-section"><h3>调用其他 App 的工具</h3><p className="install-availability">Moss 将转发调用并把结果返回给当前 App。授权覆盖目标 App 当前及以后启用的实例和子服务。工具可能读取或修改目标 App 可访问的数据。</p><Table label="调用的跨 App 工具" columns={['目标 App', '工具']}>{usesTools.flatMap(item => item.tools.map(tool => <tr key={`${item.appId}:${tool}`}><td>{item.appId}</td><td><code>{tool}</code></td></tr>))}</Table></section>}
        {provides.length > 0 && <section className="install-capability-section"><h3>供其他 App 调用的能力</h3><Table label="提供的跨 App 能力" columns={['能力协议 / 方法', '动作与权限']}>{provides.flatMap(item => item.methods.map(method => <tr key={`${item.protocol}:${method.name}`}><td><strong>{method.name}</strong><code className="install-secondary-id">{item.protocol}</code></td><td><dl className="install-method"><dt>动作</dt><dd>{method.action}</dd><dt>权限</dt><dd>{method.permission}</dd>{method.resourceReadMethod && <><dt>结果读取</dt><dd>{method.resourceReadMethod}</dd></>}</dl></td></tr>))}</Table></section>}
      </> : <p className="install-empty">此 App 没有声明跨 App 能力。</p>}</>}
    </div>
  </div>;
}
