import * as React from 'react';
import { cn } from '@/lib/utils';

export function ToolDescription({ description, toolName }: { description: string; toolName: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [truncated, setTruncated] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const contentId = React.useId();

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || expanded) return;

    const measure = () => setTruncated(content.scrollHeight > content.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div>
      <div
        id={contentId}
        ref={contentRef}
        className={cn('whitespace-pre-wrap break-words', !expanded && 'line-clamp-2')}
      >
        {description}
      </div>
      {(truncated || expanded) && (
        <button
          type="button"
          className="mt-1 block text-primary hover:underline"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={`${expanded ? '收起' : '展开'} ${toolName} 的说明`}
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}
