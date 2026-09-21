import { createHash, X509Certificate } from 'node:crypto';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';

const TRUST_RECORD_VERSION = 1;
const SELF_SIGNED_ERROR = 'DEPTH_ZERO_SELF_SIGNED_CERT';
const CERTIFICATE_CHANGED_CODE = 'REMOTE_CERTIFICATE_CHANGED';

export class RemoteCertificateChangedError extends Error {
  constructor({ origin, oldFingerprint, newFingerprint }) {
    super(
      `Moss Server ${origin} 的证书已发生变化，已拒绝连接。旧指纹：${oldFingerprint}；新指纹：${newFingerprint}。`,
    );
    this.name = 'RemoteCertificateChangedError';
    this.code = CERTIFICATE_CHANGED_CODE;
    this.origin = origin;
    this.oldFingerprint = oldFingerprint;
    this.newFingerprint = newFingerprint;
  }
}

export function isRemoteCertificateChangedError(error) {
  return Boolean(
    error
    && typeof error === 'object'
    && error.code === CERTIFICATE_CHANGED_CODE
    && typeof error.origin === 'string'
    && typeof error.oldFingerprint === 'string'
    && typeof error.newFingerprint === 'string',
  );
}

function normalizeFingerprint(value) {
  const text = String(value || '').trim();
  if (/^sha256\//i.test(text)) {
    try {
      return Buffer.from(text.slice(text.indexOf('/') + 1), 'base64').toString('hex').toUpperCase();
    } catch {
      return '';
    }
  }
  return text.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

function formatFingerprint(value) {
  return normalizeFingerprint(value).match(/.{1,2}/g)?.join(':') || '';
}

function certificatePem(raw) {
  const body = Buffer.from(raw).toString('base64').match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

function normalizedHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function parseServerOrigin(serverUrl) {
  let url;
  try {
    url = new URL(String(serverUrl || '').trim().replace(/\/+$/, ''));
  } catch {
    throw new Error('Moss Server 地址无效，请检查协议、主机和端口。');
  }
  const hostname = normalizedHostname(url.hostname);
  const loopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Moss Server 地址必须是 origin，不能包含凭据、路径、查询参数或 fragment。');
  }
  if (url.protocol === 'http:' && loopback) {
    return { origin: url.origin, hostname, secure: false };
  }
  if (url.protocol !== 'https:') {
    throw new Error('远端 Moss Server 必须使用 HTTPS。');
  }
  return {
    origin: url.origin,
    hostname,
    port: Number(url.port || 443),
    secure: true,
  };
}

function validateCertificateIdentity(certificate, hostname) {
  const identity = net.isIP(hostname)
    ? certificate.checkIP(hostname)
    : certificate.checkHost(hostname);
  if (!identity) {
    throw new Error(`Moss Server 证书与主机 ${hostname} 不匹配，已拒绝连接。`);
  }

  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now > validTo) {
    throw new Error('Moss Server 证书尚未生效或已经过期，已拒绝连接。');
  }
}

function isSelfSigned(certificate) {
  try {
    return certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey);
  } catch {
    return false;
  }
}

export async function probeRemoteTlsCertificate(serverUrl, { timeoutMs = 10_000 } = {}) {
  const target = parseServerOrigin(serverUrl);
  if (!target.secure) return { ...target, trustedBySystem: true };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const socket = tls.connect({
      host: target.hostname,
      port: target.port,
      rejectUnauthorized: false,
      ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }),
    });
    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`连接 Moss Server ${target.origin} 超时。`));
    });
    socket.once('error', (error) => finish(error));
    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate(true);
        if (!peer?.raw) throw new Error('Moss Server 未返回 TLS 证书。');
        const certificate = new X509Certificate(peer.raw);
        validateCertificateIdentity(certificate, target.hostname);
        const authorizationError = socket.authorizationError
          ? String(socket.authorizationError)
          : '';
        if (!socket.authorized) {
          if (authorizationError !== SELF_SIGNED_ERROR || !isSelfSigned(certificate)) {
            throw new Error(
              `Moss Server TLS 证书校验失败（${authorizationError || 'unknown certificate error'}），已拒绝连接。`,
            );
          }
        }
        finish(null, {
          ...target,
          trustedBySystem: socket.authorized,
          selfSigned: isSelfSigned(certificate),
          fingerprint256: formatFingerprint(certificate.fingerprint256),
          pem: certificatePem(peer.raw),
          validFrom: certificate.validFrom,
          validTo: certificate.validTo,
        });
      } catch (error) {
        finish(error);
      }
    });
  });
}

async function atomicWrite(filePath, contents, mode = 0o600) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, contents, { encoding: 'utf8', mode });
  await fsp.rename(tempPath, filePath);
  await fsp.chmod(filePath, mode);
}

function recordId(origin) {
  return createHash('sha256').update(origin).digest('hex');
}

export function createRemoteDirectTrustStore({
  trustDir,
  probeCertificate = probeRemoteTlsCertificate,
  initialExtraCaPath = process.env.NODE_EXTRA_CA_CERTS,
} = {}) {
  if (!trustDir) throw new Error('Remote Direct certificate trust directory is required.');
  const bundlePath = path.join(trustDir, 'trusted-ca-bundle.pem');
  const records = new Map();

  const rebuildBundle = async () => {
    const chunks = [];
    if (initialExtraCaPath && path.resolve(initialExtraCaPath) !== path.resolve(bundlePath)) {
      try {
        chunks.push(await fsp.readFile(initialExtraCaPath, 'utf8'));
      } catch {
        // Ignore a stale user-provided CA path; core TLS will report a normal error if needed.
      }
    }
    for (const record of records.values()) chunks.push(record.pem);
    if (chunks.length === 0) {
      await fsp.rm(bundlePath, { force: true });
      if (process.env.NODE_EXTRA_CA_CERTS === bundlePath) delete process.env.NODE_EXTRA_CA_CERTS;
      return null;
    }
    await fsp.mkdir(trustDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(trustDir, 0o700);
    await atomicWrite(bundlePath, `${chunks.map((chunk) => chunk.trim()).join('\n')}\n`);
    process.env.NODE_EXTRA_CA_CERTS = bundlePath;
    return bundlePath;
  };

  const load = async () => {
    records.clear();
    await fsp.mkdir(trustDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(trustDir, 0o700);
    const names = await fsp.readdir(trustDir);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const metadata = JSON.parse(await fsp.readFile(path.join(trustDir, name), 'utf8'));
        if (
          metadata?.version !== TRUST_RECORD_VERSION
          || typeof metadata.origin !== 'string'
          || typeof metadata.hostname !== 'string'
          || typeof metadata.fingerprint256 !== 'string'
          || typeof metadata.certificateFile !== 'string'
          || path.basename(metadata.certificateFile) !== metadata.certificateFile
        ) continue;
        const pem = await fsp.readFile(path.join(trustDir, metadata.certificateFile), 'utf8');
        const certificate = new X509Certificate(pem);
        const parsedOrigin = parseServerOrigin(metadata.origin);
        if (!parsedOrigin.secure || parsedOrigin.hostname !== metadata.hostname || !isSelfSigned(certificate)) {
          continue;
        }
        validateCertificateIdentity(certificate, metadata.hostname);
        if (normalizeFingerprint(certificate.fingerprint256) !== normalizeFingerprint(metadata.fingerprint256)) {
          continue;
        }
        records.set(metadata.origin, {
          ...metadata,
          fingerprint256: formatFingerprint(metadata.fingerprint256),
          pem,
        });
      } catch {
        // Ignore malformed records instead of preventing the desktop app from starting.
      }
    }
    return rebuildBundle();
  };

  const removeRecord = async (origin) => {
    const existing = records.get(origin);
    if (!existing) return;
    records.delete(origin);
    await Promise.all([
      fsp.rm(path.join(trustDir, existing.certificateFile), { force: true }),
      fsp.rm(path.join(trustDir, `${recordId(origin)}.json`), { force: true }),
    ]);
  };

  const persistObservedCertificate = async (target, observed) => {
    // A certificate accepted by the operating system should follow the normal
    // CA trust and renewal rules instead of remaining pinned to an old TOFU
    // record. This also supports migrating a Server from self-signed TLS to a
    // certificate issued by a trusted CA.
    if (observed.trustedBySystem && !observed.selfSigned) {
      await removeRecord(target.origin);
      const caBundlePath = await rebuildBundle();
      return { ...observed, pinned: false, caBundlePath };
    }

    const id = recordId(target.origin);
    const certificateFile = `${id}.pem`;
    const metadata = {
      version: TRUST_RECORD_VERSION,
      origin: target.origin,
      hostname: target.hostname,
      fingerprint256: formatFingerprint(observed.fingerprint256),
      certificateFile,
      trustedAt: new Date().toISOString(),
      validFrom: observed.validFrom,
      validTo: observed.validTo,
    };
    await fsp.mkdir(trustDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(trustDir, 0o700);
    await atomicWrite(path.join(trustDir, certificateFile), observed.pem);
    await atomicWrite(path.join(trustDir, `${id}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
    records.set(target.origin, { ...metadata, pem: observed.pem });
    const caBundlePath = await rebuildBundle();
    return {
      ...observed,
      pinned: true,
      caBundlePath,
    };
  };

  const ensureTrusted = async (serverUrl) => {
    const target = parseServerOrigin(serverUrl);
    if (!target.secure) return { ...target, pinned: false, caBundlePath: null };
    const observed = await probeCertificate(target.origin);
    const existing = records.get(target.origin);
    if (existing && normalizeFingerprint(existing.fingerprint256) !== normalizeFingerprint(observed.fingerprint256)) {
      throw new RemoteCertificateChangedError({
        origin: target.origin,
        oldFingerprint: formatFingerprint(existing.fingerprint256),
        newFingerprint: formatFingerprint(observed.fingerprint256),
      });
    }
    if (observed.trustedBySystem && !observed.selfSigned && !existing) {
      return { ...observed, pinned: false, caBundlePath: process.env.NODE_EXTRA_CA_CERTS || null };
    }
    if (!existing) {
      return persistObservedCertificate(target, observed);
    }
    const caBundlePath = await rebuildBundle();
    return {
      ...observed,
      pinned: true,
      caBundlePath,
    };
  };

  const acceptChangedCertificate = async (serverUrl, expectedFingerprint) => {
    const target = parseServerOrigin(serverUrl);
    if (!target.secure) return { ...target, pinned: false, caBundlePath: null };

    const existing = records.get(target.origin);
    if (!existing) {
      throw new Error(`Moss Server ${target.origin} 没有需要替换的已固定证书。`);
    }

    const expected = normalizeFingerprint(expectedFingerprint);
    if (!expected) throw new Error('缺少待接受的新证书指纹。');

    // Probe again after the user confirms. Never accept a certificate that is
    // different from the exact fingerprint shown in the confirmation dialog.
    const observed = await probeCertificate(target.origin);
    const current = normalizeFingerprint(observed.fingerprint256);
    if (current !== expected) {
      throw new RemoteCertificateChangedError({
        origin: target.origin,
        oldFingerprint: formatFingerprint(existing.fingerprint256),
        newFingerprint: formatFingerprint(observed.fingerprint256),
      });
    }

    if (normalizeFingerprint(existing.fingerprint256) === current) {
      const caBundlePath = await rebuildBundle();
      return { ...observed, pinned: true, caBundlePath };
    }

    return persistObservedCertificate(target, observed);
  };

  const verifyCertificate = (request, callback) => {
    const hostname = normalizedHostname(String(request?.hostname || ''));
    const fingerprint = normalizeFingerprint(
      request?.certificate?.fingerprint256 || request?.certificate?.fingerprint,
    );
    const hostRecords = [...records.values()].filter((record) => record.hostname === hostname);
    if (
      request?.verificationResult === 'net::ERR_CERT_AUTHORITY_INVALID'
      && hostRecords.some((record) => normalizeFingerprint(record.fingerprint256) === fingerprint)
    ) {
      callback(0);
      return;
    }
    callback(hostRecords.length > 0 ? -2 : -3);
  };

  return {
    bundlePath,
    acceptChangedCertificate,
    ensureTrusted,
    load,
    verifyCertificate,
    getRecords: () => [...records.values()].map(({ pem: _pem, ...record }) => ({ ...record })),
  };
}

export async function ensureRemoteDirectTrustWithConfirmation({
  trustStore,
  serverUrl,
  confirmCertificateChange,
}) {
  try {
    return await trustStore.ensureTrusted(serverUrl);
  } catch (error) {
    if (!isRemoteCertificateChangedError(error)) throw error;
    const accepted = await confirmCertificateChange({
      origin: error.origin,
      oldFingerprint: error.oldFingerprint,
      newFingerprint: error.newFingerprint,
    });
    if (!accepted) throw new Error('认证已取消。');
    return trustStore.acceptChangedCertificate(serverUrl, error.newFingerprint);
  }
}
