import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function TerminalWindow() {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [info, setInfo] = React.useState({ title: '终端', cwd: '', shell: '' });
  const [status, setStatus] = React.useState('正在启动…');
  const [error, setError] = React.useState('');
  const [generation, setGeneration] = React.useState(0);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const requestId = crypto.randomUUID();
    const api = window.mossTerminal;
    let disposed = false;
    let running = false;
    let exited = false;
    setError('');
    setStatus('正在启动…');
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 14, fontFamily: 'Menlo, Consolas, monospace',
      scrollback: 10000, theme: { background: '#10151c', foreground: '#e2e8f0', cursor: '#86efac' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    const reportError = (reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    };
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight || disposed) return;
      fit.fit();
      if (running) void api.resize({ requestId, cols: terminal.cols, rows: terminal.rows }).catch(reportError);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const offData = api.onData((event) => {
      if (event.requestId === requestId && !disposed) terminal.write(event.data);
    });
    const offExit = api.onExit((event) => {
      if (event.requestId !== requestId || disposed) return;
      exited = true;
      running = false;
      setStatus(`已退出（${event.exitCode}）`);
    });
    const input = terminal.onData((data) => {
      if (running) void api.write({ requestId, data }).catch(reportError);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      const mac = /Mac/.test(navigator.platform);
      const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!modifier || event.altKey) return true;
      const key = event.key.toLowerCase();
      const copy = key === 'c' && terminal.hasSelection();
      const paste = key === 'v';
      if (!copy && !paste) return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        if (copy) void navigator.clipboard.writeText(terminal.getSelection()).catch(reportError);
        else void navigator.clipboard.readText().then((text) => {
          if (!disposed) terminal.paste(text);
        }).catch(reportError);
      }
      return false;
    });
    // Defer startup so StrictMode's discarded mount never launches a second CLI.
    const timer = window.setTimeout(() => {
      void api.start({ requestId, cols: terminal.cols, rows: terminal.rows }).then((result) => {
        if (disposed || !result) return;
        running = !exited;
        setInfo(result);
        document.title = `${result.title} - Moss`;
        if (!exited) setStatus('运行中');
        resize();
        terminal.focus();
      }).catch((reason) => {
        reportError(reason);
        if (!disposed) setStatus('启动失败');
      });
    }, 0);
    return () => {
      disposed = true;
      running = false;
      window.clearTimeout(timer);
      observer.disconnect();
      offData();
      offExit();
      input.dispose();
      terminal.dispose();
      void api.stop({ requestId }).catch(() => {});
    };
  }, [generation]);

  return (
    <main className="flex h-screen flex-col bg-[#10151c] text-slate-200">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-xs">
        <strong className="shrink-0">{info.title}</strong>
        <span className="min-w-0 flex-1 truncate text-slate-400" title={info.cwd}>{info.cwd}</span>
        <span className="shrink-0 text-slate-400">{status}</span>
        {(error || status.startsWith('已退出')) && (
          <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setGeneration((value) => value + 1)}>重新启动</button>
        )}
      </header>
      {error && <div role="alert" className="px-4 py-2 text-sm text-red-300">{error}</div>}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-2" aria-label="交互式终端" />
    </main>
  );
}
