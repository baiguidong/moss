/**
 * 漫剧模块 - 入口文件
 * 导出主进程服务
 */

import { initComicDramaDatabase, registerComicDramaIpcHandlers } from './bridge.mjs';

export { initComicDramaDatabase, registerComicDramaIpcHandlers };

export default { initComicDramaDatabase, registerComicDramaIpcHandlers };
