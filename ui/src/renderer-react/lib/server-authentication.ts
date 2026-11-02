import * as React from 'react';
import type { DesktopSettings } from '../types';
import { cleanIpcErrorMessage } from './app-notifications';

export function serverAuthenticationError(error: unknown) {
  const message = cleanIpcErrorMessage(error);
  if (/ERR_CERT_|certificate|证书/i.test(message)) return `服务器证书校验失败，请核对服务器地址和证书后重试。${message}`;
  if (/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) return '无法连接 Moss Server，请检查服务器地址和网络连接后重试。';
  if (/timeout|timed.?out|超时/i.test(message)) return '连接或登录超时，请检查网络后重试。';
  return message;
}

export function useServerAuthentication(onAuthenticated: (settings: DesktopSettings) => void) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  const [serverUrl, setServerUrl] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const continuation = React.useRef<(() => void) | undefined>(undefined);
  const attempt = React.useRef(0);
  const busy = React.useRef(false);
  const open = (url = '', options: { afterLogin?: () => void; notice?: string } = {}) => {
    continuation.current = options.afterLogin;
    setNotice(options.notice || '');
    if (busy.current) return;
    setServerUrl(url.trim()); setError(''); setState('idle');
    if (url.trim()) {
      setVisible(false);
      void authenticate(url, { showProgress: false });
    } else setVisible(true);
  };
  const authenticate = async (url: string, { showProgress = true } = {}) => {
    if (showProgress) setVisible(true);
    if (busy.current) return;
    const id = ++attempt.current;
    setServerUrl(url.trim()); setError('');
    if (!url.trim()) { setState('idle'); setError('请先填写 Moss Server 地址。'); return; }
    busy.current = true; setState('loading');
    let afterLogin: (() => void) | undefined;
    try {
      // Accept an IP/domain directly in the login page; never downgrade remote TLS.
      const address = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      const parsed = new URL(address);
      if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('请填写服务器 IP 或域名，可包含端口；不要包含路径或账号密码。');
      const settings = await window.agentDesktop.authenticateRemoteServer({ serverUrl: parsed.origin });
      if (attempt.current !== id) return;
      onAuthenticated(settings); setState('success'); setVisible(false);
      afterLogin = continuation.current; continuation.current = undefined;
    } catch (cause) {
      if (attempt.current !== id) return;
      setState('idle');
      const message = serverAuthenticationError(cause);
      if (message === '认证已取消。') { continuation.current = undefined; setVisible(false); }
      else { setError(message); setVisible(true); }
    } finally { if (attempt.current === id) busy.current = false; }
    afterLogin?.();
  };
  const cancel = async () => {
    continuation.current = undefined;
    if (!busy.current) { setVisible(false); return; }
    // Do not let a late callback from this attempt overwrite a subsequent login.
    const id = ++attempt.current;
    try {
      await window.agentDesktop.cancelRemoteServerAuthentication();
      if (attempt.current === id) { setState('idle'); setError(''); setVisible(false); }
    } catch (cause) {
      if (attempt.current === id) { setState('idle'); setError(serverAuthenticationError(cause)); setVisible(true); }
    } finally { if (attempt.current === id) busy.current = false; }
  };
  return { state, error, visible, serverUrl, notice, open, authenticate, cancel,
    setServerUrl: (value: string) => { if (!busy.current) { setServerUrl(value); setError(''); } },
    dismiss: () => { continuation.current = undefined; setVisible(false); }, reset: () => { if (!busy.current) { setState('idle'); setError(''); } },
  };
}

export type ServerAuthentication = ReturnType<typeof useServerAuthentication>;
