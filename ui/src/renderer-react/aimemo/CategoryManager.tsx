/**
 * 分类管理 - 预设 + 自定义分类增删改
 */

import * as React from 'react';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { aiMemoAPI } from './ipc/aiMemo.ipc';
import type { MemoCategory } from './ipc/types';

const COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444', '#94a3b8'];

export function CategoryManager() {
  const [categories, setCategories] = React.useState<MemoCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<number | 'new' | null>(null);
  const [form, setForm] = React.useState({ name: '', aiPrompt: '', color: COLORS[0] });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setCategories((await aiMemoAPI.getCategories()) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const startEdit = (cat?: MemoCategory) => {
    if (cat) {
      setEditingId(cat.id);
      setForm({ name: cat.name, aiPrompt: cat.ai_prompt || '', color: cat.color || COLORS[0] });
    } else {
      setEditingId('new');
      setForm({ name: '', aiPrompt: '', color: COLORS[0] });
    }
  };

  const save = async () => {
    if (!form.name.trim()) return;
    if (editingId === 'new') {
      await aiMemoAPI.addCategory({ name: form.name.trim(), aiPrompt: form.aiPrompt, color: form.color });
    } else if (typeof editingId === 'number') {
      await aiMemoAPI.updateCategory({ id: editingId, name: form.name.trim(), aiPrompt: form.aiPrompt, color: form.color });
    }
    setEditingId(null);
    load();
  };

  const remove = async (id: number) => {
    const res = await aiMemoAPI.deleteCategory(id);
    if (res?.error) alert(res.error);
    else load();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => startEdit()} className="gap-1">
            <Plus className="h-4 w-4" /> 新增分类
          </Button>
        </div>

        {editingId === 'new' && (
          <CategoryForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditingId(null)} />
        )}

        {categories.map((cat) =>
          editingId === cat.id ? (
            <CategoryForm key={cat.id} form={form} setForm={setForm} onSave={save} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={cat.id} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: cat.color || '#94a3b8' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {cat.name}
                  {!!cat.is_builtin && <span className="text-[10px] text-muted-foreground">内置</span>}
                </div>
                {cat.ai_prompt && <div className="truncate text-xs text-muted-foreground">{cat.ai_prompt}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => startEdit(cat)}>
                编辑
              </Button>
              {!cat.is_builtin && (
                <Button variant="ghost" size="sm" onClick={() => remove(cat.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

interface FormProps {
  form: { name: string; aiPrompt: string; color: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; aiPrompt: string; color: string }>>;
  onSave: () => void;
  onCancel: () => void;
}

function CategoryForm({ form, setForm, onSave, onCancel }: FormProps) {
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-card p-3">
      <input
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="分类名称"
        className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-primary"
      />
      <textarea
        value={form.aiPrompt}
        onChange={(e) => setForm((f) => ({ ...f, aiPrompt: e.target.value }))}
        placeholder="AI 归类提示词(描述什么内容归到这个分类)"
        className="h-16 w-full resize-none rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-primary"
      />
      <div className="flex items-center gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setForm((f) => ({ ...f, color: c }))}
            className="h-5 w-5 rounded-full ring-offset-2"
            style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : 'none' }}
          />
        ))}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={onSave} className="gap-1">
            <Save className="h-3.5 w-3.5" /> 保存
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CategoryManager;
