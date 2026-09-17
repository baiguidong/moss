import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolPermissionCard } from "../src/renderer-react/components/chat/tool-permission-card";
import type { AskUserQuestionRequest } from "../src/renderer-react/types";

test("tool permission renders inline with direct approval actions", () => {
  const request: AskUserQuestionRequest = {
    requestId: "permission-1",
    sessionId: "session-1",
    requestedAt: 1,
    input: {
      questions: [{
        header: "运行命令",
        question: "允许 Agent 在这台电脑上运行下面的命令吗？",
        multiSelect: false,
        options: [
          { label: "允许运行", description: "仅允许本次工具调用。" },
          { label: "本次会话允许", description: "本次会话不再询问。" },
        ],
      }],
      metadata: {
        source: "session:tool-permission",
        toolName: "Bash",
        title: "运行命令",
        toolInput: {
          command: "git status --short",
          description: "检查工作区状态",
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    <ToolPermissionCard request={request} onSubmit={async () => {}} onReject={async () => {}} />,
  );

  expect(markup).toContain("允许 Moss 执行此命令？");
  expect(markup).toContain("等待审批");
  expect(markup).toContain("git status --short");
  expect(markup).toContain(">允许</button>");
  expect(markup).toContain("本次会话允许");
  expect(markup).toContain("拒绝");
  expect(markup).toContain("border-[#a57820]");
  expect(markup).not.toContain("fixed inset-0");
});

test("browser permission names the current page and offers an origin-scoped session grant", () => {
  const request: AskUserQuestionRequest = {
    requestId: "permission-browser",
    sessionId: "session-1",
    requestedAt: 1,
    input: {
      questions: [{
        header: "浏览器权限",
        question: "允许 Agent 在 https://example.test 读取页面并截图吗？",
        multiSelect: false,
        options: [
          {
            label: "允许一次",
            description: "仅允许本次浏览器操作。",
            preview: "操作：读取页面并截图\n页面：Account\n网址：https://example.test/account",
          },
          {
            label: "本次会话允许此网站",
            description: "本次会话内允许 Agent 继续操作 https://example.test。",
          },
        ],
      }],
      metadata: {
        source: "session:tool-permission",
        toolName: "moss",
        title: "浏览器权限",
        toolInput: {
          action: "browser_snapshot",
          current_url: "https://example.test/account",
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    <ToolPermissionCard request={request} onSubmit={async () => {}} onReject={async () => {}} />,
  );

  expect(markup).toContain("允许 Moss 操作当前网页？");
  expect(markup).toContain("https://example.test/account");
  expect(markup).toContain("本次会话允许此网站");
});
