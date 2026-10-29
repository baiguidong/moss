import { MessageSquareText } from 'lucide-react';
import type { VisualizationAnnotation } from '../../../shared/visualization-annotation.mjs';

export function VisualizationAnnotationCard({ annotation }: { annotation: VisualizationAnnotation }) {
  return <details data-visualization-annotation className="max-w-full rounded-xl border border-border/70 bg-muted/30 text-sm">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2"><MessageSquareText className="h-4 w-4 text-muted-foreground" />1 处标注</summary>
    <div className="max-w-sm space-y-2 border-t border-border/60 px-3 py-2">
      {annotation.selection.pageNumber && <p className="text-xs text-muted-foreground">第 {annotation.selection.pageNumber} 页</p>}
      {annotation.selection.text && <blockquote className="line-clamp-3 border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">{annotation.selection.text}</blockquote>}
      <p className="whitespace-pre-wrap break-words">{annotation.comment}</p>
    </div>
  </details>;
}
