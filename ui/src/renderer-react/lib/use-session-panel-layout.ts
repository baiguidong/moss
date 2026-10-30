import * as React from 'react';

export const MIN_CONVERSATION_WIDTH = 360;
export const MIN_PRESENTATION_WIDTH = 320;

export type SessionPanelLayout = {
  rightWidth: number;
  rightCollapsed: boolean;
  rightExpanded: boolean;
};

export function useSessionPanelLayout({ enabled, layout, onChange }: {
  enabled: boolean;
  layout: SessionPanelLayout;
  onChange: (patch: Partial<SessionPanelLayout>) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState(0);
  const [activeTab, selectTab] = React.useState<'conversation' | 'presentation'>('presentation');

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setAvailableWidth(container.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const tabbed = enabled && !layout.rightCollapsed && (layout.rightExpanded
    || (availableWidth > 0 && availableWidth - layout.rightWidth < MIN_CONVERSATION_WIDTH));
  const conversationHidden = tabbed && activeTab === 'presentation';
  const presentationHidden = !enabled || layout.rightCollapsed || (tabbed && activeTab === 'conversation');
  const rightWidth = presentationHidden ? 0 : tabbed ? availableWidth : layout.rightWidth;

  const restoreSplit = () => {
    onChange({
      rightExpanded: false,
      rightWidth: Math.max(MIN_PRESENTATION_WIDTH, Math.min(layout.rightWidth, availableWidth - MIN_CONVERSATION_WIDTH)),
      // A narrow window cannot fit both panes. Keep the conversation reachable.
      rightCollapsed: availableWidth < MIN_CONVERSATION_WIDTH + MIN_PRESENTATION_WIDTH,
    });
    selectTab('conversation');
  };

  const beginResize = () => {
    const startWidth = rightWidth;
    return (delta: number) => {
      const nextWidth = Math.max(Math.min(MIN_PRESENTATION_WIDTH, availableWidth), Math.min(availableWidth, startWidth - delta));
      const expanded = availableWidth - nextWidth < MIN_CONVERSATION_WIDTH;
      // Preserve the last split width so restoring the split is predictable.
      onChange(expanded ? { rightExpanded: true } : { rightExpanded: false, rightWidth: nextWidth });
      selectTab('presentation');
    };
  };

  return { containerRef, tabbed, activeTab, selectTab, conversationHidden, presentationHidden, rightWidth, restoreSplit, beginResize };
}
