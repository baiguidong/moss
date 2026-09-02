import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionTreeChildItem } from "../src/renderer-react/components/session-tree-child-item";

describe("shared child session tree item", () => {
  test("renders a clickable running child with the shared active state", () => {
    const html = renderToStaticMarkup(
      <SessionTreeChildItem
        title="界面审阅员 · 检查布局"
        busy
        status="running"
        isActive
        isLastChild
        onClick={() => {}}
      />,
    );

    expect(html).toContain("打开子会话：界面审阅员 · 检查布局，运行中");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("animate-pulse bg-sky-500");
  });

  test("renders terminal failure without an active marker", () => {
    const html = renderToStaticMarkup(
      <SessionTreeChildItem
        title="反方审阅员"
        busy={false}
        status="failed"
        isActive={false}
        isLastChild={false}
        onClick={() => {}}
      />,
    );

    expect(html).toContain("打开子会话：反方审阅员，失败");
    expect(html).not.toContain("aria-current");
    expect(html).toContain("bg-destructive");
  });
});
