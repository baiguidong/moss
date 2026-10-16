import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, Cloud, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogOut, Monitor, UserRound } from 'lucide-react';
import './globals.css';
import './web-interface.css';

function LoginScreen({ mode, onLogin }: { mode: string; onLogin: (values: Record<string, FormDataEntryValue>) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const server = mode === 'server';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true); setError('');
    try { await onLogin(values); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法登录，请重试。');
      setPending(false);
    }
  };

  return <main className="moss-login">
    <div className="moss-login-layout">
      <header className="moss-login-brand"><img src="./build/icon.png" alt="" /><span>moss</span><span className="moss-login-brand-label">云电脑</span></header>
      <div className="moss-login-content">
        <section className="moss-login-intro">
          <div className="moss-login-eyebrow"><span />你的专属工作空间</div>
          <h1>你的工作，<br /><span>随时继续。</span></h1>
          <p>让 Moss 帮你处理任务。会话、文件和已安装的工具，都留在这里。</p>
          <div className="moss-login-benefits"><span><Cloud />云端保存</span><span><Monitor />浏览器直达</span></div>
        </section>
        <section className="moss-login-card" aria-labelledby="moss-login-title">
          <div className="moss-login-card-icon"><Monitor aria-hidden="true" /></div>
          <h2 id="moss-login-title">登录你的云电脑</h2>
          <p className="moss-login-subtitle">{server ? '欢迎回来，使用 Moss 账号继续。' : '输入此云电脑的访问密钥以继续。'}</p>
          <form onSubmit={submit} aria-busy={pending}>
            <fieldset disabled={pending}>
              {server && <label className="moss-login-field" htmlFor="moss-username">账号
                <span className="moss-login-input"><UserRound aria-hidden="true" /><input id="moss-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="输入你的账号" required /></span>
              </label>}
              <label className="moss-login-field" htmlFor="moss-secret">{server ? '密码' : '访问密钥'}</label>
              <div className="moss-login-input">
                {server ? <LockKeyhole aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                <input id="moss-secret" name={server ? 'password' : 'token'} type={showSecret ? 'text' : 'password'} autoComplete="current-password" placeholder={server ? '输入你的密码' : '输入访问密钥'} required aria-describedby={error ? 'moss-login-error' : undefined} />
                <button className="moss-login-reveal" type="button" aria-label={`${showSecret ? '隐藏' : '显示'}${server ? '密码' : '访问密钥'}`} aria-pressed={showSecret} onClick={() => setShowSecret(value => !value)}>{showSecret ? <EyeOff /> : <Eye />}</button>
              </div>
              {error && <p id="moss-login-error" className="moss-login-error" role="alert">{error}</p>}
              <button className="moss-login-submit" type="submit">{pending ? <><LoaderCircle className="moss-web-spinner" />正在进入云电脑…</> : <>登录<ArrowRight aria-hidden="true" /></>}</button>
            </fieldset>
            <p className="moss-login-hint" role="status">{pending ? '正在准备你的工作空间，请保持页面打开。' : <><Check aria-hidden="true" />下次登录，继续上次的工作</>}</p>
          </form>
        </section>
      </div>
      <footer className="moss-login-footer">一个属于你的空间，随时回来。</footer>
    </div>
  </main>;
}

export function showWebLogin(mode: string, onLogin: (values: Record<string, FormDataEntryValue>) => Promise<{ reload?: boolean }>) {
  const root = createRoot(document.getElementById('root')!);
  return new Promise<void>(resolve => {
    root.render(<LoginScreen mode={mode} onLogin={async values => {
      const result = await onLogin(values);
      if (result.reload) { location.reload(); return; }
      root.unmount(); resolve();
    }} />);
  });
}

const connectionLabels: Record<string, string> = {
  connected: '已连接', connecting: '正在连接…', disconnected: '正在重连…',
  unauthenticated: '登录已失效', incompatible: '版本已更新',
};

function WebSessionControls({ status, onLogout }: { status: string; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (open && !node?.open) node?.showModal();
    else if (!open && node?.open) node.close();
  }, [open]);
  const logout = async () => {
    if (pending) return;
    setPending(true); setError('');
    try { await onLogout(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出失败，请重试。');
      setPending(false);
    }
  };
  return <>
    <div className="moss-web-session" aria-label="云电脑连接">
      <span className="moss-web-connection" role="status"><span className={`moss-web-dot ${status === 'connected' ? 'is-connected' : ''}`} /><span>我的云电脑</span><span className="moss-web-connection-detail">{connectionLabels[status] || status}</span></span>
      {(status === 'unauthenticated' || status === 'incompatible') && <button type="button" onClick={() => location.reload()}>刷新</button>}
      <button ref={trigger} type="button" className="moss-web-logout" onClick={() => { setError(''); setOpen(true); }}><LogOut aria-hidden="true" />退出登录</button>
    </div>
    <dialog ref={dialog} className="moss-web-confirm" aria-labelledby="moss-logout-title" aria-describedby="moss-logout-description" aria-busy={pending}
      onCancel={event => { if (pending) event.preventDefault(); else setOpen(false); }}
      onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}>
      <div className="moss-web-confirm-icon"><LogOut aria-hidden="true" /></div>
      <h2 id="moss-logout-title">退出当前登录？</h2>
      <p id="moss-logout-description">云电脑和正在运行的任务会继续保留。下次登录，即可回到你的工作空间。</p>
      {error && <p className="moss-web-confirm-error" role="alert">{error}</p>}
      <div className="moss-web-confirm-actions">
        <button type="button" autoFocus disabled={pending} onClick={() => setOpen(false)}>取消</button>
        <button type="button" className="moss-web-confirm-submit" disabled={pending} onClick={() => void logout()}>{pending ? '正在退出…' : '退出登录'}</button>
      </div>
    </dialog>
  </>;
}

export function mountWebSessionControls(onLogout: () => Promise<void>) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const updateStatus = (status: string) => root.render(<WebSessionControls status={status} onLogout={onLogout} />);
  updateStatus('connecting');
  return updateStatus;
}
