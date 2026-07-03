/**
 * AI 备忘录模块 - 入口文件
 * 导出主进程服务
 */

import { initAiMemoDatabase, registerAiMemoIpcHandlers } from './bridge.mjs';

export {
  initAiMemoDatabase,
  registerAiMemoIpcHandlers,
};

export default {
  initAiMemoDatabase,
  registerAiMemoIpcHandlers,
};
