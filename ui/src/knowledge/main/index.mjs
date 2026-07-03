/**
 * 知识库模块 - 入口文件
 * 导出主进程服务
 */

import { initKnowledgeDatabase, registerKnowledgeIpcHandlers } from './bridge.mjs';

export { initKnowledgeDatabase, registerKnowledgeIpcHandlers };

export default {
  initKnowledgeDatabase,
  registerKnowledgeIpcHandlers,
};
