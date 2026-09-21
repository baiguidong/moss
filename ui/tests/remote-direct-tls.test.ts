import { X509Certificate } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { describe, expect, it } from 'bun:test';

import {
  createRemoteDirectTrustStore,
  ensureRemoteDirectTrustWithConfirmation,
  RemoteCertificateChangedError,
} from '../src/remote-direct-tls.mjs';

const TEST_SELF_SIGNED_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDNjCCAh6gAwIBAgIUJiSQO43ohydDjDsHwniKCbjA+GwwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQbW9zcy5leGFtcGxlLmNvbTAgFw0yNjA5MjAwMzU4NDZa
GA8yMTI2MDgyNzAzNTg0NlowGzEZMBcGA1UEAwwQbW9zcy5leGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKgWbHHzyJRLzY+zyT6oaxyH
q0oybeNK+ewzBmY93pKdIx6zAPDXKJOvcPcEmq7CbdvzycMd5N6lG5iiAb9lPw8M
XzvlgBYuIOWvP99aRt1VHLlWJJoNnPSrjh2D4uGGPL89R9Yc40zV06vI03SeTjqi
S5+58ZZcqoQDK/xLHu8rV+lDrQ0OaWLJud+Hd4vKhluKGoUKV9ZjY4Eg9isI8g58
9pBlsEzQnO+pAQKZpvj2fhs2qMKXE7ATwV69gRP/nW4CEfDqNaR4atd176+xEXC7
YgU6z2nkKhhZwEeWIjZDjCOemLlUXh8Uv3/vsjBGz7IZpwhq9vxa5X8cJOoh7eEC
AwEAAaNwMG4wHQYDVR0OBBYEFIsExvP7yyB/+6fcU6BFYFEBGz9HMB8GA1UdIwQY
MBaAFIsExvP7yyB/+6fcU6BFYFEBGz9HMBsGA1UdEQQUMBKCEG1vc3MuZXhhbXBs
ZS5jb20wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEApupbFLwI
MRjqUJdkMHTajrS2r+/qiU93azv1FrJOmUrIPqizkVRbCHvcbHGV7vpwH/DLDxPT
Ry7QnXmxogHZOQ1ytnUM9W9x/SB5vO4JHGqRLChvu40zYnLvqlduRFXmowx1exBR
HCdATv4roqd77B0zaYGMh56RRpfIU6K20mnGF8fDwor2xSETHTcVowyLfzupTksZ
pmah3wfPfNlUays0rwJJPP8nrn61n1WSN/tgWCvQ+jCoYPYYG4ZGHMs0vBzqd0Wr
ur4ZM6Tt1ALhKbpnYFB7Cq1KoR80bbw5ljHj3u9pNHI8c/VaxvcwujxRxr9BDgUF
56srLDJVinrXOw==
-----END CERTIFICATE-----`;

function observedCertificate(pem: string, trustedBySystem = false, selfSigned = true) {
  const certificate = new X509Certificate(pem);
  return {
    origin: 'https://moss.example.com',
    hostname: 'moss.example.com',
    port: 443,
    secure: true,
    trustedBySystem,
    selfSigned,
    fingerprint256: certificate.fingerprint256,
    pem,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
  };
}

describe('remote direct TLS trust store', () => {
  it('pins the first certificate and replaces it only after explicit confirmation', async () => {
    const trustDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-remote-tls-'));
    const originalExtraCa = process.env.NODE_EXTRA_CA_CERTS;
    let observed = observedCertificate(TEST_SELF_SIGNED_CERTIFICATE, true);
    const store = createRemoteDirectTrustStore({
      trustDir,
      initialExtraCaPath: '',
      probeCertificate: async () => observed,
    });

    try {
      await store.load();
      const trusted = await store.ensureTrusted('https://moss.example.com');
      expect(trusted.pinned).toBe(true);
      expect(trusted.caBundlePath).toBe(path.join(trustDir, 'trusted-ca-bundle.pem'));
      expect(process.env.NODE_EXTRA_CA_CERTS).toBe(trusted.caBundlePath);

      let verificationResult: number | undefined;
      const electronFingerprint = `sha256/${Buffer.from(
        observed.fingerprint256.replaceAll(':', ''),
        'hex',
      ).toString('base64')}`;
      store.verifyCertificate({
        hostname: 'moss.example.com',
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        certificate: { fingerprint: electronFingerprint },
      }, (result: number) => { verificationResult = result; });
      expect(verificationResult).toBe(0);
      store.verifyCertificate({
        hostname: 'moss.example.com',
        verificationResult: 'net::ERR_CERT_DATE_INVALID',
        certificate: { fingerprint: electronFingerprint },
      }, (result: number) => { verificationResult = result; });
      expect(verificationResult).toBe(-2);

      const reloaded = createRemoteDirectTrustStore({
        trustDir,
        initialExtraCaPath: '',
        probeCertificate: async () => observed,
      });
      await reloaded.load();
      expect(reloaded.getRecords()).toHaveLength(1);

      observed = observedCertificate(tls.rootCertificates[1]);
      let changedError: unknown;
      try {
        await reloaded.ensureTrusted('https://moss.example.com');
      } catch (error) {
        changedError = error;
      }
      expect(changedError).toBeInstanceOf(RemoteCertificateChangedError);
      expect(changedError).toMatchObject({
        code: 'REMOTE_CERTIFICATE_CHANGED',
        origin: 'https://moss.example.com',
        oldFingerprint: trusted.fingerprint256,
        newFingerprint: observed.fingerprint256,
      });

      reloaded.verifyCertificate({
        hostname: 'moss.example.com',
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        certificate: { fingerprint: observed.fingerprint256 },
      }, (result: number) => { verificationResult = result; });
      expect(verificationResult).toBe(-2);
      reloaded.verifyCertificate({
        hostname: 'other.example.com',
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        certificate: { fingerprint: observed.fingerprint256 },
      }, (result: number) => { verificationResult = result; });
      expect(verificationResult).toBe(-3);

      await expect(reloaded.acceptChangedCertificate(
        'https://moss.example.com',
        trusted.fingerprint256,
      )).rejects.toBeInstanceOf(RemoteCertificateChangedError);
      expect(reloaded.getRecords()[0]?.fingerprint256).toBe(trusted.fingerprint256);

      await expect(ensureRemoteDirectTrustWithConfirmation({
        trustStore: reloaded,
        serverUrl: 'https://moss.example.com',
        confirmCertificateChange: async () => false,
      })).rejects.toThrow('认证已取消');
      expect(reloaded.getRecords()[0]?.fingerprint256).toBe(trusted.fingerprint256);

      let confirmation: Record<string, string> | undefined;
      const replaced = await ensureRemoteDirectTrustWithConfirmation({
        trustStore: reloaded,
        serverUrl: 'https://moss.example.com',
        confirmCertificateChange: async (details: Record<string, string>) => {
          confirmation = details;
          return true;
        },
      });
      expect(confirmation).toEqual({
        origin: 'https://moss.example.com',
        oldFingerprint: trusted.fingerprint256,
        newFingerprint: observed.fingerprint256,
      });
      expect(replaced).toMatchObject({
        pinned: true,
        fingerprint256: observed.fingerprint256,
      });
      expect(reloaded.getRecords()[0]?.fingerprint256).toBe(observed.fingerprint256);

      reloaded.verifyCertificate({
        hostname: 'moss.example.com',
        verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
        certificate: { fingerprint: observed.fingerprint256 },
      }, (result: number) => { verificationResult = result; });
      expect(verificationResult).toBe(0);

      await expect(ensureRemoteDirectTrustWithConfirmation({
        trustStore: reloaded,
        serverUrl: 'https://moss.example.com',
        confirmCertificateChange: async () => {
          throw new Error('不应再次要求确认');
        },
      })).resolves.toMatchObject({ pinned: true });
    } finally {
      if (originalExtraCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = originalExtraCa;
      await fsp.rm(trustDir, { recursive: true, force: true });
    }
  });

  it('does not pin certificates already accepted by the system trust store', async () => {
    const trustDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-remote-tls-'));
    const originalExtraCa = process.env.NODE_EXTRA_CA_CERTS;
    const observed = observedCertificate(tls.rootCertificates[0], true, false);
    const store = createRemoteDirectTrustStore({
      trustDir,
      initialExtraCaPath: '',
      probeCertificate: async () => observed,
    });

    try {
      await store.load();
      await expect(store.ensureTrusted('https://moss.example.com')).resolves.toMatchObject({
        pinned: false,
      });
      expect(store.getRecords()).toHaveLength(0);
    } finally {
      if (originalExtraCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = originalExtraCa;
      await fsp.rm(trustDir, { recursive: true, force: true });
    }
  });
});
