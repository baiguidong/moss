import { randomUUID } from 'node:crypto';

// Certificate verification is cached by Chromium's network context. A fresh
// context lets an explicitly accepted certificate take effect without restarting.
export function createRemoteDirectTransport({ session, ensureTrustLoaded, certificateVerifyProc, fallbackFetch }) {
  let current;
  return {
    async fetch(input, init) {
      await ensureTrustLoaded();
      if (fallbackFetch) return fallbackFetch(input, init);
      if (!current) {
        current = session.fromPartition(`moss-account-${randomUUID()}`);
        current.setCertificateVerifyProc(certificateVerifyProc);
      }
      return current.fetch(input, init);
    },
    reset() {
      const previous = current;
      current = null;
      // These sessions carry bearer requests, never browser login cookies.
      if (previous) void Promise.allSettled([
        Promise.resolve().then(() => previous.closeAllConnections()),
        Promise.resolve().then(() => previous.clearStorageData()),
      ]);
    },
  };
}
