import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getFeishuAdapterFingerprint,
  hasFeishuAdapterCredentials,
} from './adapter-settings.mjs';
import {
  ADAPTER_BRIDGE_VERSION,
  createAdapterBridgeErrorResponse,
  createAdapterBridgeMessage,
  createAdapterBridgeResponse,
  parseAdapterBridgeRequest,
} from './adapter-process-protocol.mjs';

const STOP_TIMEOUT_MS = 5_000;
const RESTART_MAX_DELAY_MS = 30_000;

function waitForExit(child, timeoutMs = STOP_TIMEOUT_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

function forwardLines(stream, level, log) {
  if (!stream?.on) return;
  let pending = '';
  stream.setEncoding?.('utf8');
  stream.on('data', (chunk) => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) log(level, line.trim());
    }
  });
  stream.on('end', () => {
    if (pending.trim()) log(level, pending.trim());
  });
}

export function resolveFeishuAdapterEntryPath({ isPackaged, resourcesPath, uiRoot }) {
  return isPackaged
    ? path.join(resourcesPath, 'adapters', 'feishu.mjs')
    : path.join(uiRoot, 'dist', 'adapters', 'feishu.mjs');
}

export function createFeishuAdapterProcessManager({
  entryPath,
  configDir,
  runtimePath = process.execPath,
  spawn = spawnProcess,
  exists = fs.existsSync,
  log = () => {},
  onRequest = async () => {
    throw new Error('Adapter request handler is not configured.');
  },
  onReady = () => {},
  onStatusChange = () => {},
  restartBaseDelayMs = 1_000,
  handshakeTimeoutMs = 15_000,
}) {
  let child = null;
  let fingerprint = '';
  let bridgeReady = false;
  let transition = Promise.resolve();
  let lastStatus = 'stopped';
  let lastError = null;
  let desiredConfig = null;
  let restartTimer = null;
  let restartAttempt = 0;
  let disposed = false;
  let handshakeTimer = null;

  function clearRestartTimer() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function clearHandshakeTimer() {
    if (handshakeTimer) clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }

  function scheduleRestart(config) {
    if (disposed || restartTimer || !hasFeishuAdapterCredentials(config)) return;
    const delay = Math.min(restartBaseDelayMs * (2 ** restartAttempt), RESTART_MAX_DELAY_MS);
    restartAttempt += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      transition = transition.catch(() => {}).then(() => apply(desiredConfig || config));
    }, delay);
    restartTimer.unref?.();
    log('info', `Feishu Adapter restart scheduled in ${delay}ms`);
  }

  function emitStatus() {
    onStatusChange(getStatus());
  }

  function sendToChild(message) {
    if (!child || child.exitCode !== null || child.signalCode !== null || typeof child.send !== 'function') {
      return false;
    }
    try {
      child.send(message);
      return true;
    } catch (error) {
      log('error', `Unable to send Feishu Adapter IPC message: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  function send(type, payload = {}) {
    if (!bridgeReady) return false;
    return sendToChild(createAdapterBridgeMessage(type, payload));
  }

  async function handleChildMessage(started, value) {
    if (child !== started) return;
    const request = parseAdapterBridgeRequest(value);
    if (!request) {
      log('error', 'Ignored invalid Feishu Adapter IPC request');
      return;
    }
    try {
      if (request.type === 'bridge.hello') {
        clearHandshakeTimer();
        bridgeReady = true;
        const result = {
          protocolVersion: ADAPTER_BRIDGE_VERSION,
          adapter: 'feishu',
          ...(await onReady(request.payload) || {}),
        };
        sendToChild(createAdapterBridgeResponse(request, result));
        sendToChild(createAdapterBridgeMessage('bridge.ready', result));
        emitStatus();
        return;
      }
      const result = await onRequest(request);
      sendToChild(createAdapterBridgeResponse(request, result));
    } catch (error) {
      sendToChild(createAdapterBridgeErrorResponse(request, error));
      log('error', `Feishu Adapter request failed (${request.type}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function stopCurrent(nextStatus = 'stopped') {
    const running = child;
    child = null;
    fingerprint = '';
    bridgeReady = false;
    lastStatus = nextStatus;
    lastError = null;
    clearHandshakeTimer();
    emitStatus();
    if (!running || running.exitCode !== null || running.signalCode !== null) return;

    running.kill('SIGTERM');
    if (await waitForExit(running)) return;
    running.kill('SIGKILL');
    await waitForExit(running, 1_000);
  }

  async function apply(config) {
    const nextFingerprint = getFeishuAdapterFingerprint(config);
    if (!hasFeishuAdapterCredentials(config)) {
      await stopCurrent('disabled');
      log('info', 'Feishu Adapter not started: credentials are not configured');
      return { status: 'disabled', pid: null };
    }

    if (
      child &&
      child.exitCode === null &&
      child.signalCode === null &&
      fingerprint === nextFingerprint
    ) {
      return { status: 'running', pid: child.pid ?? null };
    }

    await stopCurrent();
    if (!exists(entryPath)) {
      const message = `Feishu Adapter entry not found: ${entryPath}`;
      lastStatus = 'error';
      lastError = message;
      emitStatus();
      log('error', message);
      return { status: 'error', pid: null, error: message };
    }

    let started;
    try {
      started = spawn(runtimePath, [entryPath], {
        cwd: path.dirname(entryPath),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          MOSS_CONFIG_DIR: configDir,
          MOSS_HOME: configDir,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastStatus = 'error';
      lastError = message;
      emitStatus();
      scheduleRestart(config);
      throw error;
    }
    child = started;
    fingerprint = nextFingerprint;
    bridgeReady = false;
    lastStatus = 'running';
    lastError = null;
    started.on('message', (value) => {
      void handleChildMessage(started, value);
    });
    handshakeTimer = setTimeout(() => {
      if (child !== started || bridgeReady) return;
      lastError = 'Feishu Adapter IPC handshake timed out.';
      log('error', lastError);
      started.kill('SIGTERM');
    }, handshakeTimeoutMs);
    handshakeTimer.unref?.();
    forwardLines(started.stdout, 'info', log);
    forwardLines(started.stderr, 'error', log);
    started.once('error', (error) => {
      clearHandshakeTimer();
      if (child === started) {
        child = null;
        fingerprint = '';
        bridgeReady = false;
        lastStatus = 'error';
        lastError = error.message;
        scheduleRestart(config);
      }
      emitStatus();
      log('error', `Feishu Adapter failed to start: ${error.message}`);
    });
    started.once('exit', (code, signal) => {
      clearHandshakeTimer();
      const unexpected = child === started;
      if (child === started) {
        child = null;
        fingerprint = '';
        bridgeReady = false;
        lastStatus = code === 0 ? 'stopped' : 'error';
        lastError = code === 0
          ? null
          : lastError || `Adapter exited with code ${code ?? 'unknown'}`;
      }
      emitStatus();
      const detail = `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
      log(code === 0 || signal === 'SIGTERM' ? 'info' : 'error', `Feishu Adapter exited (${detail})`);
      if (unexpected && !disposed) scheduleRestart(config);
    });
    log('info', `Feishu Adapter started (pid=${started.pid ?? 'unknown'})`);
    emitStatus();
    return { status: 'running', pid: started.pid ?? null };
  }

  function sync(config) {
    desiredConfig = config;
    disposed = false;
    clearRestartTimer();
    transition = transition.catch(() => {}).then(() => apply(config));
    return transition;
  }

  function stop() {
    desiredConfig = null;
    clearRestartTimer();
    clearHandshakeTimer();
    transition = transition.catch(() => {}).then(() => stopCurrent());
    return transition;
  }

  function dispose() {
    disposed = true;
    desiredConfig = null;
    clearRestartTimer();
    clearHandshakeTimer();
    const running = child;
    child = null;
    fingerprint = '';
    bridgeReady = false;
    lastStatus = 'stopped';
    lastError = null;
    if (running && running.exitCode === null && running.signalCode === null) {
      running.kill('SIGTERM');
    }
  }

  function getStatus() {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return {
        status: lastStatus,
        pid: null,
        bridgeReady: false,
        ...(lastError ? { error: lastError } : {}),
      };
    }
    return { status: 'running', pid: child.pid ?? null, bridgeReady };
  }

  function markHealthy() {
    if (child && bridgeReady) restartAttempt = 0;
  }

  return { sync, stop, dispose, getStatus, send, markHealthy };
}
