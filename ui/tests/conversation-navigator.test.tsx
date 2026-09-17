import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildConversationNavigationItems,
  ConversationNavigator,
  getActiveConversationNavigationItemId,
} from "../src/renderer-react/components/chat/conversation-navigator";

describe("conversation navigator", () => {
  const items = buildConversationNavigationItems([
    { id: "turn-1", content: "第一轮：检查问题", renderIndex: 0 },
    { id: "empty", content: "  ", renderIndex: 1 },
    { id: "turn-2", content: "第二轮：修改实现", renderIndex: 3, attachmentCount: 1 },
    { id: "turn-3", content: "第三轮：运行测试", renderIndex: 6 },
    { id: "turn-4", content: "第四轮：总结结果", renderIndex: 9 },
  ]);

  it("builds consecutive markers for non-empty user turns", () => {
    expect(items.map((item) => item.turnNumber)).toEqual([1, 2, 3, 4]);
    expect(items[1]).toEqual(expect.objectContaining({
      id: "turn-2",
      renderIndex: 3,
      attachmentCount: 1,
    }));
  });

  it("tracks the user turn nearest the visible list start", () => {
    expect(getActiveConversationNavigationItemId(items, 0)).toBe("turn-1");
    expect(getActiveConversationNavigationItemId(items, 5)).toBe("turn-2");
    expect(getActiveConversationNavigationItemId(items, 99)).toBe("turn-4");
  });

  it("renders the cc-haha style clickable vertical rail", () => {
    const markup = renderToStaticMarkup(
      <ConversationNavigator items={items} activeItemId="turn-2" onNavigate={() => {}} />,
    );

    expect(markup).toContain('aria-label="对话导航"');
    expect(markup).toContain('aria-label="第 2 / 4 轮：第二轮：修改实现"');
    expect(markup).toContain('aria-current="location"');
    expect(markup).toContain('bg-[#a24632]');
    expect(markup.match(/data-turn-number=/g)?.length).toBe(4);
  });
});
