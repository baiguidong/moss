import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
const hash = value => createHash('sha256').update(String(value || '')).digest();
export function createWebLifecycle({ secret, getBlockers = () => [], activeCount = () => 0, now = Date.now }) {
  let until = 0;
  const version = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
  return {
    version,
    authorized(req) { return Boolean(secret) && timingSafeEqual(hash(req.headers['x-moss-control']), hash(secret)); },
    status() { return { version, maintenance: until > now(), blockers: [...getBlockers(), ...(activeCount() ? ['正在处理请求'] : [])] }; },
    drain() {
      const status = this.status();
      if (status.blockers.length) throw new Error(`云电脑仍在工作：${status.blockers.join('、')}。请完成任务、回答确认并退出终端后再升级。`);
      until = now() + 10 * 60_000; return this.status();
    },
    resume() { until = 0; },
    assertWorkAllowed() { if (until > now()) throw new Error('云电脑正在维护，请稍后重试。'); },
  };
}
