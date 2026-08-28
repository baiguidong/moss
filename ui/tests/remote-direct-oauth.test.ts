import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { performRemoteDirectOAuth } from '../src/remote-direct-oauth.mjs';

const AUTHORIZATION_CODE = 'a'.repeat(43);

describe('remote direct OAuth', () => {
  it('opens the server authorization page and exchanges the loopback callback with PKCE', async () => {
    let startBody: Record<string, string> | null = null;
    let openedUrl = '';
    let authorizationClosed = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/oauth/start')) {
        startBody = JSON.parse(String(init?.body));
        return Response.json({
          authorization_url: `/api/v1/auth/oauth/authorize/${'t'.repeat(43)}`,
          expires_in: 600,
        });
      }
      if (url.endsWith('/api/v1/auth/oauth/exchange')) {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.redirect_uri).toBe(startBody?.redirect_uri);
        expect(body.code_verifier).toHaveLength(64);
        expect(createHash('sha256').update(body.code_verifier, 'ascii').digest('base64url'))
          .toBe(startBody?.code_challenge);
        expect(body.code).toBe(AUTHORIZATION_CODE);
        return Response.json({
          api_key: 'moss_sk_test.secret',
          user: { id: 'user-1' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const result = await performRemoteDirectOAuth({
      serverUrl: 'https://moss.example.com',
      fetchImpl,
      openAuthorization: async (url: string, context: { redirectUri: string }) => {
        openedUrl = url;
        if (!startBody) throw new Error('Missing OAuth start body');
        expect(context.redirectUri).toBe(startBody.redirect_uri);
        const rejected = await fetch(
          `${startBody.redirect_uri}?code=wrong-code&state=wrong-state`,
        );
        expect(rejected.status).toBe(400);
        const malformed = await fetch(
          `${startBody.redirect_uri}?code=short&state=${startBody.state}`,
        );
        expect(malformed.status).toBe(400);
        await fetch(
          `${startBody.redirect_uri}?code=${AUTHORIZATION_CODE}&state=${startBody.state}`,
        );
        return () => { authorizationClosed = true; };
      },
    });

    expect(openedUrl).toBe(
      `https://moss.example.com/api/v1/auth/oauth/authorize/${'t'.repeat(43)}`,
    );
    expect(result).toEqual({
      serverUrl: 'https://moss.example.com',
      apiKey: 'moss_sk_test.secret',
      user: { id: 'user-1' },
    });
    expect(authorizationClosed).toBe(true);
  });

  it('rejects plain HTTP for a remote server', async () => {
    await expect(performRemoteDirectOAuth({
      serverUrl: 'http://moss.example.com',
      openAuthorization: async () => {},
    })).rejects.toThrow('远端认证要求 HTTPS');
  });

  it('reports an invalid server address without starting a listener', async () => {
    await expect(performRemoteDirectOAuth({
      serverUrl: 'moss.example.com',
      openAuthorization: async () => {},
    })).rejects.toThrow('Moss Server 地址无效');
  });

  it('applies the timeout to the initial server request', async () => {
    await expect(performRemoteDirectOAuth({
      serverUrl: 'https://moss.example.com',
      fetchImpl: ((input: string | URL | Request) => (
        String(input).endsWith('/api/v1/auth/oauth/cancel')
          ? Response.json({ canceled: true })
          : new Promise(() => {})
      )) as typeof fetch,
      openAuthorization: async () => {},
      timeoutMs: 10,
    })).rejects.toThrow('认证超时');
  });

  it('cancels an in-flight authentication immediately', async () => {
    const controller = new AbortController();
    let requestStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    let cancellationBody: Record<string, string> | null = null;
    const authentication = performRemoteDirectOAuth({
      serverUrl: 'https://moss.example.com',
      fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith('/api/v1/auth/oauth/cancel')) {
          cancellationBody = JSON.parse(String(init?.body));
          return Promise.resolve(Response.json({ canceled: true }));
        }
        requestStarted();
        return new Promise(() => {});
      }) as typeof fetch,
      openAuthorization: async () => {},
      signal: controller.signal,
    });

    await started;
    controller.abort(new Error('认证已取消。'));
    await expect(authentication).rejects.toThrow('认证已取消');
    expect(cancellationBody?.state).toHaveLength(43);
    expect(cancellationBody?.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it('reclaims an authorization code when canceled during exchange', async () => {
    const controller = new AbortController();
    let startBody: Record<string, string> | null = null;
    let exchangeStarted: () => void = () => {};
    const exchanging = new Promise<void>((resolve) => {
      exchangeStarted = resolve;
    });
    let cancellationBody: Record<string, string> | null = null;
    let authorizationClosed = false;
    const authentication = performRemoteDirectOAuth({
      serverUrl: 'https://moss.example.com',
      signal: controller.signal,
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/v1/auth/oauth/start')) {
          startBody = JSON.parse(String(init?.body));
          return Response.json({
            authorization_url: `/api/v1/auth/oauth/authorize/${'t'.repeat(43)}`,
          });
        }
        if (url.endsWith('/api/v1/auth/oauth/exchange')) {
          exchangeStarted();
          return new Promise(() => {});
        }
        if (url.endsWith('/api/v1/auth/oauth/cancel')) {
          cancellationBody = JSON.parse(String(init?.body));
          return Response.json({ canceled: true });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch,
      openAuthorization: async () => {
        if (!startBody) throw new Error('Missing OAuth start body');
        await fetch(
          `${startBody.redirect_uri}?code=${AUTHORIZATION_CODE}&state=${startBody.state}`,
        );
        return () => { authorizationClosed = true; };
      },
    });

    await exchanging;
    controller.abort(new Error('认证已取消。'));
    await expect(authentication).rejects.toThrow('认证已取消');
    expect(cancellationBody?.code).toBe(AUTHORIZATION_CODE);
    expect(authorizationClosed).toBe(true);
  });
});
