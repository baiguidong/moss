/**
 * AI 备忘录模块 - IPC 客户端
 */

import type { AiMemoAPI, AnalyzeProgress } from './types';

const invoke = <T>(channel: string, params?: unknown): Promise<T> =>
  window.agentDesktop.ipcInvoke(channel, params ?? {}) as Promise<T>;

export const aiMemoAPI: AiMemoAPI = {
  voiceEnabled: () => invoke('aiMemo:voiceEnabled'),
  transcribe: (audioBase64, mimeType) => invoke('aiMemo:transcribe', { audioBase64, mimeType }),
  createNote: (params) => invoke('aiMemo:createNote', params),
  analyzeNote: (noteId) => invoke('aiMemo:analyzeNote', { noteId }),
  getNotes: (filter) => invoke('aiMemo:getNotes', { filter }),
  getNoteDetail: (noteId) => invoke('aiMemo:getNoteDetail', { noteId }),
  deleteNote: (noteId) => invoke('aiMemo:deleteNote', { noteId }),
  getCategories: () => invoke('aiMemo:getCategories'),
  addCategory: (params) => invoke('aiMemo:addCategory', params),
  updateCategory: (params) => invoke('aiMemo:updateCategory', params),
  deleteCategory: (id) => invoke('aiMemo:deleteCategory', { id }),
  getTasks: (filter) => invoke('aiMemo:getTasks', { filter }),
  updateTask: (params) => invoke('aiMemo:updateTask', params),
  buildTaskPrompt: (taskId) => invoke('aiMemo:buildTaskPrompt', { taskId }),
  onAnalyzeProgress: (callback: (data: AnalyzeProgress) => void) => {
    // preload 的 ipcOn 已剥离 event,只回传 data,并返回包装后的 handler 供 ipcOff 使用
    const wrapped = (window.agentDesktop.ipcOn as unknown as (
      channel: string,
      cb: (data: AnalyzeProgress) => void,
    ) => unknown)('aiMemo:analyzeProgress', (data) => callback(data));
    return () => window.agentDesktop.ipcOff('aiMemo:analyzeProgress', wrapped);
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as { aiMemo: AiMemoAPI }).aiMemo = aiMemoAPI;
}

export default aiMemoAPI;
