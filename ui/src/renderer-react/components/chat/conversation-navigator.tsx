"use client";

import * as React from "react";
import { createPortal } from "react-dom";

export type ConversationNavigationSource = {
  id: string;
  content: string;
  renderIndex: number;
  attachmentCount?: number;
};

export type ConversationNavigationItem = {
  id: string;
  renderIndex: number;
  turnNumber: number;
  preview: string;
  attachmentCount: number;
};

const NAVIGATION_ITEM_HEIGHT = 12;
const NAVIGATION_ITEM_GAP = 1;
const NAVIGATION_PADDING = 6;
const RESTING_WIDTH = 7;
const ACTIVE_WIDTH = 14;
const EXPANDED_WIDTH = 22;

function normalizePreview(content: string) {
  const normalized = content
    .slice(0, 2_000)
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/```[a-z0-9_-]*\s*/gi, " ")
    .replace(/```/g, " ")
    .replace(/[`*_>#~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 179).trimEnd()}...`;
}

export function buildConversationNavigationItems(
  sources: ConversationNavigationSource[],
): ConversationNavigationItem[] {
  const items: ConversationNavigationItem[] = [];
  for (const source of sources) {
    const preview = normalizePreview(source.content);
    if (!preview) continue;
    items.push({
      id: source.id,
      renderIndex: source.renderIndex,
      turnNumber: items.length + 1,
      preview,
      attachmentCount: source.attachmentCount || 0,
    });
  }
  return items;
}

export function getActiveConversationNavigationItemId(
  items: ConversationNavigationItem[],
  visibleStartIndex: number,
) {
  if (items.length === 0) return null;
  let active = items[0]!;
  for (const item of items) {
    if (item.renderIndex > visibleStartIndex) break;
    active = item;
  }
  return active.id;
}

function markerWidth(itemIndex: number, interactionIndex: number | null) {
  if (interactionIndex === null) return RESTING_WIDTH;
  const distance = Math.abs(itemIndex - interactionIndex);
  if (distance >= 2) return RESTING_WIDTH;
  const proximity = 1 - distance / 2;
  const eased = Math.sin(proximity * Math.PI / 2) ** 2;
  return RESTING_WIDTH + (EXPANDED_WIDTH - RESTING_WIDTH) * eased;
}

export function ConversationNavigator({
  items,
  activeItemId,
  onNavigate,
}: {
  items: ConversationNavigationItem[];
  activeItemId: string | null;
  onNavigate: (item: ConversationNavigationItem) => void;
}) {
  const [previewItemId, setPreviewItemId] = React.useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = React.useState({ left: 0, top: 0 });
  const [pointerIndex, setPointerIndex] = React.useState<number | null>(null);
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const markerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const activeInteractionIndex = pointerIndex ?? focusIndex;
  const previewItem = items.find((item) => item.id === previewItemId) ?? null;

  React.useEffect(() => {
    if (!activeItemId) return;
    markerRefs.current.get(activeItemId)?.scrollIntoView({ block: "nearest" });
  }, [activeItemId]);

  if (items.length < 4) return null;

  const openPreview = (itemId: string, marker: HTMLButtonElement) => {
    const rect = marker.getBoundingClientRect();
    setPreviewPosition({
      left: rect.right + 8,
      top: Math.min(window.innerHeight - 80, Math.max(80, rect.top + rect.height / 2)),
    });
    setPreviewItemId(itemId);
  };

  return (
    <nav
      aria-label="对话导航"
      className="absolute left-1.5 top-1/2 z-20 hidden max-h-[64%] -translate-y-1/2 flex-col overflow-visible md:flex"
    >
      <div
        className="flex w-8 max-h-full flex-col items-start gap-px overflow-y-auto overflow-x-hidden py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const firstCenter = NAVIGATION_PADDING + NAVIGATION_ITEM_HEIGHT / 2;
          const pointerOffset = event.clientY - rect.top + event.currentTarget.scrollTop;
          const nextIndex = (pointerOffset - firstCenter) / (NAVIGATION_ITEM_HEIGHT + NAVIGATION_ITEM_GAP);
          setPointerIndex(Math.min(items.length - 1, Math.max(0, nextIndex)));
        }}
        onMouseLeave={() => setPointerIndex(null)}
      >
        {items.map((item, index) => {
          const active = item.id === activeItemId;
          const interactionTarget = activeInteractionIndex !== null
            && Math.round(activeInteractionIndex) === index;
          const width = active ? ACTIVE_WIDTH : markerWidth(index, activeInteractionIndex);
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) markerRefs.current.set(item.id, node);
                else markerRefs.current.delete(item.id);
              }}
              type="button"
              data-turn-number={item.turnNumber}
              aria-label={`第 ${item.turnNumber} / ${items.length} 轮：${item.preview}`}
              aria-current={active ? "location" : undefined}
              onMouseEnter={(event) => openPreview(item.id, event.currentTarget)}
              onMouseLeave={(event) => {
                if (document.activeElement !== event.currentTarget) setPreviewItemId(null);
              }}
              onFocus={(event) => {
                setFocusIndex(index);
                openPreview(item.id, event.currentTarget);
              }}
              onBlur={() => {
                setFocusIndex(null);
                setPreviewItemId(null);
              }}
              onClick={() => onNavigate(item)}
              className="group flex h-3 w-8 shrink-0 items-center rounded-sm pl-0.5 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className={[
                  "block h-px origin-left rounded-full transition-[transform,background-color,opacity] duration-200 ease-out motion-reduce:transition-none group-focus-visible:ring-1 group-focus-visible:ring-ring",
                  active
                    ? "h-0.5 bg-[#a24632] opacity-100 dark:bg-[#ef8d78]"
                    : interactionTarget
                      ? "bg-foreground opacity-90"
                      : "bg-muted-foreground opacity-60 group-hover:bg-foreground group-hover:opacity-90",
                ].join(" ")}
                style={{ width: RESTING_WIDTH, transform: `scaleX(${width / RESTING_WIDTH})` }}
              />
            </button>
          );
        })}
      </div>

      {previewItem ? createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[min(300px,calc(100vw-72px))] -translate-y-1/2 rounded-lg border border-border/80 bg-card/96 px-3 py-2.5 text-left shadow-xl backdrop-blur"
          style={{ left: previewPosition.left, top: previewPosition.top }}
        >
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">
            第 {previewItem.turnNumber} / {items.length} 轮
          </div>
          <p className="line-clamp-3 text-xs leading-5 text-foreground">{previewItem.preview}</p>
          {previewItem.attachmentCount > 0 ? (
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              {previewItem.attachmentCount} 个附件
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </nav>
  );
}
