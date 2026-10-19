import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createRestoreState } from './restore-state.mjs';
const hash = value => createHash('sha256').update(String(value || '')).digest();
export function createWebLifecycle({ secret, getBlockers = () => [], activeCount = () => 0, now = Date.now, restoreState = createRestoreState({}), onDrain = async () => {}, onResume = async () => {} }) {
  let until = 0;
  const version = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
  return {
    version,
    authorized(req) { return Boolean(secret) && timingSafeEqual(hash(req.headers['x-moss-control']), hash(secret)); },
    status() { return { version, snapshotProtocol: 1, automationsPaused: restoreState.get().automationsPaused,
      maintenance: !!restoreState.get().maintenance || until > now(), blockers: [...getBlockers(), ...(activeCount() ? ['正在处理请求'] : [])] }; },
    async drain({ operationId } = {}) {
      if (operationId && !/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Invalid maintenance operation');
      if (restoreState.get().maintenance && restoreState.get().maintenance !== operationId) throw new Error('已有维护任务');
      const status = this.status();
      if (status.blockers.length) throw new Error(`云电脑仍在工作：${status.blockers.join('、')}。请完成任务、回答确认并退出终端后再维护。`);
      if (operationId) restoreState.update({ maintenance: operationId }); else until = now() + 10 * 60_000;
      await onDrain();
      return this.status();
    },
    async resume({ operationId } = {}) {
      if (restoreState.get().maintenance && restoreState.get().maintenance !== operationId) throw new Error('维护任务不匹配');
      restoreState.update({ maintenance: null }); until = 0;
      if (!restoreState.get().automationsPaused) await onResume();
    },
    async resumeAutomations() {
      if (this.status().maintenance) throw new Error('请先完成环境维护');
      await onResume({ skipMissed: true }); restoreState.update({ automationsPaused: false });
    },
    assertWorkAllowed() { if (this.status().maintenance) throw new Error('云电脑正在维护，请稍后重试。'); },
  };
}
