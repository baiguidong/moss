import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { ServerAuthentication } from '../lib/server-authentication';

export function ServerLoginDialog({ authentication }: { authentication: ServerAuthentication }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const busy = authentication.state === 'loading';
  React.useEffect(() => {
    if (authentication.visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [authentication.visible]);
  return <dialog ref={dialog} aria-labelledby="server-login-title"
    onCancel={event => { event.preventDefault(); void authentication.cancel(); }}
    className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl backdrop:bg-black/40">
    <form onSubmit={event => { event.preventDefault(); if (!busy) void authentication.authenticate(authentication.serverUrl); }}>
    <h2 id="server-login-title" className="text-base font-semibold">登录 Moss Server</h2>
    <p className="mt-2 text-sm text-muted-foreground">输入你的服务器地址，继续登录账号。</p>
    <label htmlFor="server-login-address" className="mb-2 mt-4 block text-sm font-medium">服务器 IP 或域名</label>
    <Input id="server-login-address" autoFocus autoComplete="url" spellCheck={false} disabled={busy}
      placeholder="例如 10.0.1.181 或 https://moss.example.com" value={authentication.serverUrl}
      onChange={event => authentication.setServerUrl(event.target.value)} />
    <p className="mt-2 text-xs text-muted-foreground">IP 或域名默认使用 HTTPS，也可填写完整地址和端口。</p>
    {busy && <div role="status" className="mt-4 flex items-start gap-2 text-sm">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <p>正在连接服务器并打开登录窗口，请在登录窗口中完成认证。</p>
    </div>}
    {authentication.error && <p role="alert" className="mt-4 whitespace-pre-wrap break-words text-sm text-destructive">{authentication.error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => { if (busy) void authentication.cancel(); else authentication.dismiss(); }}>{busy ? '取消登录' : '关闭'}</Button>
      {!busy && <Button type="submit">{authentication.error ? '重新登录' : '继续登录'}</Button>}
    </div>
    </form>
  </dialog>;
}
