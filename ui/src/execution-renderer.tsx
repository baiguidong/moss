import React from 'react';
import ReactDOM from 'react-dom/client';
import './renderer-react/globals.css';

declare global {
  interface Window {
    mossExecution: {
      onAgentEvent: (callback: (data: any) => void) => () => void;
      onAgentState: (callback: (data: any) => void) => () => void;
      onInit: (callback: (data: { originalPrompt: string; plan: string; busy: boolean; workspace: string; bubble?: boolean }) => void) => () => void;
      onPermission: (callback: (data: any) => void) => () => void;
      abort: () => Promise<void>;
      listFiles: () => Promise<{ files: Array<{ name: string; path: string }>; workspace: string; error?: string }>;
      sendMessage: (msg: string) => Promise<void>;
      minimize: () => Promise<void>;
      restore: () => Promise<void>;
    };
  }
}

type Step = {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
};

type FileEntry = {
  name: string;
  path: string;
};

type ChatLine = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
};

function parsePlanToSteps(plan: string): Step[] {
  const lines = plan.split('\n').filter((line) => line.trim());
  const steps: Step[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([\d]+[.)}:\s]|[-*•]\s+)/);
    if (match) {
      steps.push({ text: trimmed.replace(/^([\d]+[.)}:\s]|[-*•]\s+)/, '').trim(), status: 'pending' });
    } else if (trimmed.length > 10) {
      steps.push({ text: trimmed, status: 'pending' });
    }
  }
  if (steps.length === 0) {
    return lines.filter(l => l.trim().length > 0).map((text) => ({ text: text.trim(), status: 'pending' }));
  }
  return steps;
}

let msgIdCounter = 0;
function nextId() { return `msg-${++msgIdCounter}`; }

function ExecutionView() {
  const [originalPrompt, setOriginalPrompt] = React.useState('');
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [chatLines, setChatLines] = React.useState<ChatLine[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);
  const [workspace, setWorkspace] = React.useState('');
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const unsubInit = window.mossExecution.onInit((state) => {
      setOriginalPrompt(state.originalPrompt);
      setSteps(parsePlanToSteps(state.plan));
      setBusy(state.busy);
      setWorkspace(state.workspace);
      setChatLines([{ id: nextId(), role: 'system', text: `开始执行计划：\n${state.originalPrompt}` }]);
    });

    const unsubEvent = window.mossExecution.onAgentEvent((event: any) => {
      const msg = event.payload || event;

      if (msg.type === 'system') return;

      if (msg.type === 'assistant' && msg.message?.content) {
        const contentBlocks = msg.message.content;
        for (const block of contentBlocks) {
          if (block?.type === 'tool_use') {
            const toolName = block.name || block.tool_name || 'Tool';
            setSteps((prev) => {
              const next = [...prev];
              const pendingIdx = next.findIndex((s) => s.status === 'pending');
              if (pendingIdx !== -1) {
                next[pendingIdx] = { ...next[pendingIdx], status: 'in_progress' };
              }
              return next;
            });
            setChatLines((prev) => [...prev, { id: nextId(), role: 'tool', text: `[${toolName}]` }]);
          } else if (block?.type === 'text') {
            const text = block.text || '';
            if (text) {
              setChatLines((prev) => [...prev, { id: nextId(), role: 'assistant', text }]);
            }
          }
        }
        return;
      }

      if (msg.type === 'user' && msg.message?.content) {
        const contentBlocks = msg.message.content;
        for (const block of contentBlocks) {
          if (block?.type === 'tool_result') {
            setSteps((prev) => {
              const next = [...prev];
              const inProgressIdx = next.findIndex((s) => s.status === 'in_progress');
              if (inProgressIdx !== -1) {
                next[inProgressIdx] = { ...next[inProgressIdx], status: 'completed' };
              }
              return next;
            });
            const result = block.content || '';
            setChatLines((prev) => [...prev, {
              id: nextId(),
              role: 'tool',
              text: `结果: ${typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200)}`,
            }]);
          }
        }
        return;
      }

      if (msg.type === 'message_stop') {
        setBusy(false);
        setCompleted(true);
        setChatLines((prev) => [...prev, { id: nextId(), role: 'system', text: '执行完成' }]);
        window.mossExecution.listFiles().then((result) => {
          if (result.files) {
            setFiles(result.files);
          }
        });
        return;
      }

      if (msg.type === 'error') {
        const errMsg = msg.message || String(msg);
        setChatLines((prev) => [...prev, { id: nextId(), role: 'system', text: `错误: ${errMsg}` }]);
        setBusy(false);
        return;
      }
    });

    const unsubState = window.mossExecution.onAgentState((state: any) => {
      setBusy(state.busy);
    });

    const unsubPermission = window.mossExecution.onPermission((perm: any) => {
      setChatLines((prev) => [...prev, { id: nextId(), role: 'system', text: `[权限] ${perm.tool || perm.action}` }]);
    });

    return () => {
      unsubInit();
      unsubEvent();
      unsubState();
      unsubPermission();
    };
  }, []);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLines]);

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setChatLines((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    await window.mossExecution.sendMessage(text);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#09111c', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0d1520', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#64748b', marginBottom: '4px' }}>
            计划执行 {completed && <span style={{ color: '#22c55e', marginLeft: 8 }}>✓ 完成</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', maxWidth: 400 }} className="truncate">
            {originalPrompt}
          </div>
        </div>
        <button
          onClick={() => void window.mossExecution.minimize()}
          style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', fontSize: 11, cursor: 'pointer' }}
        >
          最小化
        </button>
      </div>

      {/* Body: Steps + Chat */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Steps Panel */}
        <div style={{ width: 240, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '12px', overflow: 'auto' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#475569', marginBottom: 10 }}>
            执行步骤
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: step.status === 'in_progress' ? 'rgba(59,130,246,0.15)' : step.status === 'completed' ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)' }}>
                <span style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: step.status === 'completed' ? '#22c55e' : step.status === 'in_progress' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: step.status === 'pending' ? '#64748b' : '#fff',
                }}>
                  {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '●' : i + 1}
                </span>
                <span style={{
                  fontSize: 11,
                  color: step.status === 'completed' ? '#64748b' : step.status === 'in_progress' ? '#e2e8f0' : '#94a3b8',
                  textDecoration: step.status === 'completed' ? 'line-through' : 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {step.text}
                </span>
              </div>
            ))}
          </div>

          {/* Files */}
          {workspace && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#475569', marginBottom: 8 }}>
                工作区
              </div>
              <div style={{ fontSize: 10, color: '#60a5fa', wordBreak: 'break-all', marginBottom: 8 }}>{workspace}</div>
              {files.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: '#94a3b8', padding: '2px 0' }}>📄 {f.name}</div>
              ))}
              {completed && files.length === 0 && <div style={{ fontSize: 11, color: '#475569' }}>无文件</div>}
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
            {chatLines.map((line) => (
              <div key={line.id} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: line.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: line.role === 'user' ? '12px 12px 0 12px' : '12px 12px 12px 0',
                  background: line.role === 'user' ? 'rgba(59,130,246,0.2)' : line.role === 'tool' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                  border: line.role === 'user' ? '1px solid rgba(59,130,246,0.3)' : line.role === 'tool' ? '1px solid rgba(168,85,247,0.2)' : '1px solid rgba(255,255,255,0.06)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: line.role === 'system' ? '#94a3b8' : '#e2e8f0',
                  fontStyle: line.role === 'system' ? 'italic' : 'normal',
                }}>
                  {line.text}
                </div>
              </div>
            ))}
            {busy && chatLines[chatLines.length - 1]?.role !== 'assistant' && (
              <div style={{ fontSize: 12, color: '#475569' }}>思考中...</div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder="发送消息给子 Agent..."
              disabled={busy && !completed}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 20,
                padding: '8px 16px',
                color: '#e2e8f0',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || (busy && !completed)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                background: input.trim() && !busy ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: input.trim() ? '#60a5fa' : '#475569',
                fontSize: 12,
                cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
              }}
            >
              发送
            </button>
            {busy && !completed && (
              <button
                onClick={() => void window.mossExecution.abort()}
                style={{ padding: '8px 12px', borderRadius: 20, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}
              >
                停止
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExecutionView />
  </React.StrictMode>,
);
