import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';

export function ProjectInstructionsField({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [preview, setPreview] = React.useState(false);
  const id = React.useId();
  return <div className="grid min-w-0 gap-2">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">项目指令</label>
      <div className="flex gap-1">
        <Button type="button" variant={preview ? 'ghost' : 'secondary'} size="sm" className="h-6 px-2 text-xs" onClick={() => setPreview(false)}>编辑</Button>
        <Button type="button" variant={preview ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" onClick={() => setPreview(true)}>预览</Button>
      </div>
    </div>
    {preview ? <ProjectInstructionsPreview value={value} /> : <Textarea id={id} value={value} disabled={disabled}
      onChange={event => onChange(event.target.value)} maxLength={20000} placeholder="用 Markdown 编写长期协作规则"
      className="h-[180px] min-h-[180px] max-h-[180px] resize-none overflow-y-auto text-sm [field-sizing:fixed]" />}
  </div>;
}

export function ProjectInstructionsPreview({ value }: { value: string }) {
  return <div className="h-[180px] min-w-0 overflow-y-auto rounded-md border border-border px-3 py-2 text-sm" data-project-instructions-preview>
    {value ? <MarkdownRenderer content={value} variant="compact" /> : <span className="text-muted-foreground">暂无指令</span>}
  </div>;
}
