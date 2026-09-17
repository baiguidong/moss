import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  describeBrowserAutomationAction,
  getBrowserAutomationOrigin,
  isBrowserAutomationFileWithinRoot,
  isBrowserAutomationAction,
  isLocalDevelopmentBrowserUrl,
  redactBrowserAutomationUrl,
} from '../src/browser-agent-policy.mjs';

describe('browser agent policy', () => {
  it('auto-allows local development pages but leaves file scope to the session workspace policy', () => {
    expect(isLocalDevelopmentBrowserUrl('http://localhost:5173/app')).toBe(true);
    expect(isLocalDevelopmentBrowserUrl('https://preview.localhost/test')).toBe(true);
    expect(isLocalDevelopmentBrowserUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalDevelopmentBrowserUrl('http://[::1]:8080')).toBe(true);
    expect(isLocalDevelopmentBrowserUrl('file:///tmp/preview.html')).toBe(false);
    expect(isLocalDevelopmentBrowserUrl('about:blank')).toBe(true);
    expect(isLocalDevelopmentBrowserUrl('https://example.com')).toBe(false);
  });

  it('recognizes the fixed automation surface and scopes grants by origin', () => {
    expect(isBrowserAutomationAction('browser_snapshot')).toBe(true);
    expect(isBrowserAutomationAction('browser_open')).toBe(false);
    expect(isBrowserAutomationAction('browser_execute_script')).toBe(false);
    expect(getBrowserAutomationOrigin('https://example.com/private?a=1')).toBe('https://example.com');
    expect(getBrowserAutomationOrigin('file:///tmp/preview.html?token=secret#section')).toBe('file:///tmp/preview.html');
    expect(describeBrowserAutomationAction('browser_type')).toBe('向页面输入内容');
  });

  it('redacts credentials from URLs exposed in permission and tool results', () => {
    const redacted = redactBrowserAutomationUrl(
      'https://user:pass@example.com/callback?code=oauth-code&view=details#/?access_token=token-value&tab=one',
    );
    expect(redacted).not.toContain('user');
    expect(redacted).not.toContain('pass');
    expect(redacted).not.toContain('oauth-code');
    expect(redacted).not.toContain('token-value');
    expect(redacted).toContain('view=details');
    expect(redacted).toContain('tab=one');
    expect(redacted).toContain('REDACTED');
  });

  it('auto-allows file pages only when their real path stays inside the workspace', () => {
    const workspace = process.cwd();
    expect(isBrowserAutomationFileWithinRoot(
      pathToFileURL(path.join(workspace, 'package.json')).href,
      workspace,
    )).toBe(true);
    expect(isBrowserAutomationFileWithinRoot(pathToFileURL('/etc/hosts').href, workspace)).toBe(false);
    expect(isBrowserAutomationFileWithinRoot('https://example.com', workspace)).toBe(false);
  });
});
