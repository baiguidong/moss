/**
 * AI 备忘录模块 - 类型定义
 */

export interface MemoCategory {
  id: number;
  name: string;
  ai_prompt?: string;
  color?: string;
  icon?: string;
  is_builtin: number;
  sort_order: number;
}

export interface MemoNote {
  id: number;
  source: 'text' | 'voice';
  audio_path?: string;
  raw_text?: string;
  transcript?: string;
  summary?: string;
  category_id?: number | null;
  status: 'inbox' | 'classified' | 'archived';
  analyzed: number;
  created_at: string;
  updated_at: string;
  category?: { name: string; color?: string; icon?: string } | null;
  tags?: string[];
  tasks?: MemoTask[];
}

export interface MemoTask {
  id: number;
  note_id: number;
  title: string;
  detail?: string;
  due_at?: string | null;
  reminder_at?: string | null;
  priority: 'low' | 'med' | 'high';
  kind: 'reminder' | 'agent';
  status: 'pending' | 'running' | 'done';
  agent_session_id?: string | null;
  created_at: string;
  noteSummary?: string;
}

export interface AnalyzeProgress {
  noteId: number;
  status: 'analyzing' | 'done' | 'error';
  taskCount?: number;
  error?: string;
}

export interface NoteFilter {
  categoryId?: number;
  status?: string;
  limit?: number;
}

export interface AiMemoAPI {
  voiceEnabled: () => Promise<{ enabled: boolean }>;
  transcribe: (audioBase64: string, mimeType: string) => Promise<{ text?: string; audioPath?: string; error?: string }>;
  createNote: (params: { source: 'text' | 'voice'; rawText: string; audioPath?: string }) => Promise<MemoNote>;
  analyzeNote: (noteId: number) => Promise<{ success?: boolean; error?: string }>;
  getNotes: (filter?: NoteFilter) => Promise<MemoNote[]>;
  getNoteDetail: (noteId: number) => Promise<MemoNote>;
  deleteNote: (noteId: number) => Promise<{ success: boolean }>;
  getCategories: () => Promise<MemoCategory[]>;
  addCategory: (params: { name: string; aiPrompt?: string; color?: string; icon?: string }) => Promise<MemoCategory>;
  updateCategory: (params: { id: number; name: string; aiPrompt?: string; color?: string; icon?: string }) => Promise<MemoCategory>;
  deleteCategory: (id: number) => Promise<{ success?: boolean; error?: string }>;
  getTasks: (filter?: { status?: string }) => Promise<MemoTask[]>;
  updateTask: (params: { id: number; status?: string; reminderAt?: string | null; agentSessionId?: string | null; kind?: string }) => Promise<MemoTask>;
  buildTaskPrompt: (taskId: number) => Promise<{ prompt?: string; error?: string }>;
  onAnalyzeProgress: (callback: (data: AnalyzeProgress) => void) => () => void;
}

declare global {
  interface Window {
    aiMemo?: AiMemoAPI;
  }
}
