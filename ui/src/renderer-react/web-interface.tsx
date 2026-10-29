import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronRight, Cloud, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogOut, Monitor, Settings, UserRound } from 'lucide-react';
import appPackage from '../../package.json';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import './globals.css';
import './web-interface.css';

const desktopVersion = appPackage.version;
const releaseAssets = `https://github.com/baiguidong/moss/releases/download/v${desktopVersion}`;
const desktopDownloads = [
  { label: 'macOS（Apple 芯片）', href: `${releaseAssets}/Moss-${desktopVersion}-arm64.dmg` },
  { label: 'Windows 64 位', href: `${releaseAssets}/Moss-Setup-${desktopVersion}-x64.exe` },
];

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
          <div className="moss-desktop-downloads" aria-label="下载 Moss 桌面客户端">
            <span>桌面客户端 · v{desktopVersion}</span>
            <div>{desktopDownloads.map(item => <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a>)}</div>
          </div>
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
  connected: '已连接', connecting: '正在连接 Moss Server…', disconnected: '正在重连 Moss Server…',
  unauthenticated: '登录已失效', incompatible: '版本已更新', 'environment-changed': '环境已恢复，请刷新',
};

type Account = { userName: string; userEmail: string } | null;

function WebSessionControls({ status, account, onLogout }: { status: string; account: Account; onLogout: () => Promise<void> }) {
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
  const navigate = (view: 'settings') => window.dispatchEvent(new CustomEvent('moss:account-navigate', { detail: view }));
  const accountName = account?.userName || account?.userEmail || '个人中心';
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button ref={trigger} type="button" className="moss-web-account-trigger" aria-label="个人中心" title="个人中心">
          <span className="moss-web-account-avatar"><UserRound aria-hidden="true" /></span>
          <span className="moss-web-account-title" title={accountName}>{accountName}</span>
          <ChevronRight className="moss-web-account-chevron" aria-hidden="true" />
          <span className={`moss-web-dot ${status === 'connected' ? 'is-connected' : ''}`} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-(--radix-dropdown-menu-trigger-width) min-w-44">
        <DropdownMenuLabel className="space-y-1 text-xs">
          <span role="status" className="block truncate text-sm font-medium" title={accountName}>{accountName}<span className="font-normal text-muted-foreground"> {connectionLabels[status] || status}</span></span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('settings')}><Settings aria-hidden="true" />设置</DropdownMenuItem>
        <DropdownMenuSeparator />
        {(status === 'unauthenticated' || status === 'incompatible' || status === 'environment-changed') && <DropdownMenuItem onSelect={() => location.reload()}>刷新连接</DropdownMenuItem>}
        {window.mossWeb?.managed && <DropdownMenuItem asChild><a href="/?window=cloud-environment">环境快照</a></DropdownMenuItem>}
        <DropdownMenuItem asChild><a href={`https://github.com/baiguidong/moss/releases/tag/v${desktopVersion}`} target="_blank" rel="noopener noreferrer">下载桌面版 v{desktopVersion}</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { setError(''); setOpen(true); }}><LogOut aria-hidden="true" />退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

export function mountWebSessionControls(onLogout: () => Promise<void>, account: Account = null) {
  const container = document.createElement('div');
  container.hidden = true;
  document.body.append(container);
  const root = createRoot(container);
  const mountInSidebar = () => {
    const slot = document.getElementById('moss-web-account-slot');
    if (slot && container.parentElement !== slot) slot.append(container);
    if (slot) container.hidden = false;
  };
  const observer = new MutationObserver(mountInSidebar);
  observer.observe(document.getElementById('root')!, { childList: true, subtree: true });
  mountInSidebar();
  const updateStatus = (status: string) => root.render(<WebSessionControls status={status} account={account} onLogout={onLogout} />);
  updateStatus('connecting');
  return updateStatus;
}
