/**
 * 替换 bun:bundle 的运行时实现
 * 从 features.js 读取配置，决定每个 feature 是否开启
 */
import { RECOMMENDED, EXPERIMENTAL, NATIVE_REQUIRED } from './features.js'

const ENABLED = new Set(
  Object.entries({ ...RECOMMENDED, ...EXPERIMENTAL, ...NATIVE_REQUIRED })
    .filter(([, v]) => v)
    .map(([k]) => k)
)

export function feature(name) {
  return ENABLED.has(name)
}
