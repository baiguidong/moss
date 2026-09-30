import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { UserMessage } from "@/components/chat/user-message";
import { VirtualMessageList, type VirtualMessageListHandle } from "@/components/chat/message-list";
import { getChatAppearanceStyle } from "@/components/chat/chat-appearance";
import { ToolCallBlock } from "@/components/chat/tool-call-block";
import { ForkSessionButton } from "@/components/chat/fork-session-button";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ActivityGroup } from "@/components/chat/activity-group";
import { ToolDisplaySettingsProvider } from "@/components/chat/tool-display-settings";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "../../src/appearance-settings.mjs";
import type { DesktopSettings } from "@/types";
import type { TranscriptRenderMessage, ToolUseRenderMessage } from "@/lib/agent-transcript";
import "@/globals.css";

const root = createRoot(document.getElementById("root")!);
const listRef = React.createRef<VirtualMessageListHandle>();
const api = window as any;
const prompt = "选择这段用户消息，检查鼠标拖选和原生复制是否正常。";
const reply = "这段历史回复保持不变，后面的消息更新不应清除已经选中的文字。";
const user = { id: "user", role: "user", type: "user_text", content: prompt } as const;
const assistant = { id: "assistant", role: "assistant", type: "assistant_text", content: reply } as const;
const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const render = (element: React.ReactNode) => flushSync(() => root.render(element));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function waitFor(condition: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await delay(30);
  }
  throw new Error(message);
}

function select(element: Element) {
  const text = element.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, Math.min(16, text.textContent!.length));
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  return selection.toString();
}

function clearSelection() {
  window.getSelection()!.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
}

const list = (messages: TranscriptRenderMessage[], loading = false) => (
  <div style={{ height: 420, width: 850 }}>
    <VirtualMessageList ref={listRef} messages={messages} loading={loading} />
  </div>
);
const scroller = () => document.querySelector<HTMLElement>("[data-virtuoso-scroller]")!;
const bodies = () => [...document.querySelectorAll<HTMLElement>('[data-message-body="user"]')];

// UI copy buttons use this fixture clipboard; native copy events below are
// canceled after observing the selected text so tests never replace OS data.
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text: string) => { api.fixtureClipboard = text; } },
});
document.addEventListener("copy", (event) => {
  api.nativeCopyText = window.getSelection()?.toString();
  event.preventDefault();
});

api.runSelectionChecks = async () => {
  const passed: string[] = [];
  async function check(name: string, run: () => Promise<void>) {
    clearSelection();
    render(null);
    await delay();
    await run();
    passed.push(name);
  }

  await check("historical Markdown survives parent updates and appended paragraphs", async () => {
    const view = (tick: number, content = reply) => (
      <div data-tick={tick}>
        <MarkdownRenderer content={content} variant={tick ? "document" : "default"} />
        <AssistantMessage message={{ ...assistant }} />
      </div>
    );
    render(view(0));
    const paragraph = document.querySelector("p")!;
    const expected = select(paragraph);
    render(view(1));
    assert(document.querySelector("p") === paragraph, "unchanged paragraph was remounted");
    render(view(2, `${reply}\n\n这是新增加的段落。`));
    assert(document.querySelector("p") === paragraph, "appending a paragraph remounted historical text");
    assert(window.getSelection()!.toString() === expected, "Markdown selection changed");
  });

  await check("short histories stay mounted and streaming preserves selection and scroll", async () => {
    const history: TranscriptRenderMessage[] = Array.from({ length: 16 }, (_, index) => ({
      ...user, id: `short-${index}`, content: `${index} ${prompt.repeat(4)}`,
    }));
    const messages: TranscriptRenderMessage[] = [...history, assistant, { ...assistant, id: "live", streaming: true }];
    render(list(messages, true));
    await waitFor(() => bodies().length === history.length, "short history was virtualized");
    await delay(250);
    const paragraph = document.querySelector('[data-message-body="assistant"] p')!;
    const expected = select(paragraph);
    const before = scroller().scrollTop;
    render(list([...messages.slice(0, -1), { ...assistant, id: "live", content: reply.repeat(18), streaming: true }], true));
    await delay(300);
    assert(paragraph.isConnected && window.getSelection()!.toString() === expected, "streaming cleared history selection");
    assert(Math.abs(scroller().scrollTop - before) < 3, `streaming moved the viewport during selection: ${before} -> ${scroller().scrollTop}`);

    paragraph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 150, clientY: 120 }));
    await delay();
    const copy = [...document.querySelectorAll("button")].find((button) => button.textContent === "复制选中内容")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    copy.dispatchEvent(down);
    assert(down.defaultPrevented, "copy menu stole focus from the selection");
    assert(window.getSelection()!.toString() === expected, "opening copy menu cleared selection");
    copy.click();
    await delay();
    assert(api.fixtureClipboard === expected, "context menu copied the wrong text");
  });

  await check("pointer drag pauses follow before a range exists, then follow can resume", async () => {
    const messages: TranscriptRenderMessage[] = Array.from({ length: 12 }, (_, index) => ({ ...user, id: `drag-${index}`, content: prompt.repeat(3) }));
    render(list(messages));
    await waitFor(() => bodies().length === messages.length, "drag fixture did not mount");
    await delay(250);
    bodies().at(-1)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    const before = scroller().scrollTop;
    const updated = [...messages, { ...assistant, content: reply.repeat(12) }];
    render(list(updated));
    await delay(250);
    assert(Math.abs(scroller().scrollTop - before) < 3, "pointer drag was interrupted before selectionchange");
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
    scroller().scrollTop = scroller().scrollHeight;
    await delay(250);
    render(list([...updated, { ...user, id: "after-drag" }]));
    await waitFor(() => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight < 5, "auto follow did not resume at bottom");
  });

  await check("long history retains selection across scrolling and releases rows afterward", async () => {
    const messages: TranscriptRenderMessage[] = Array.from({ length: 180 }, (_, index) => ({ ...user, id: `long-${index}`, content: `${index} ${prompt.repeat(4)}` }));
    render(list(messages));
    await waitFor(() => bodies().some((element) => element.textContent!.startsWith("179 ")), "long history did not reach bottom");
    await delay(200);
    assert(bodies().length < 180, "large unselected history should still be virtualized");
    const selected = bodies().at(-1)!;
    const expected = select(selected);
    scroller().scrollTop = 0;
    scroller().dispatchEvent(new Event("scroll"));
    await waitFor(() => bodies().some((element) => element.textContent!.startsWith("0 ")), "top rows did not mount");
    assert(selected.isConnected, "scrolling unmounted a selected row");
    assert(window.getSelection()!.toString() === expected, "scrolling cleared native selection");
    listRef.current!.scrollToBottom("auto", { preserveSelection: true });
    await delay();
    assert(scroller().scrollTop < 3, "automatic permission scroll interrupted selection");
    const first = bodies().find((element) => element.textContent!.startsWith("0 "))!;
    window.getSelection()!.setBaseAndExtent(selected.firstChild!, 16, first.firstChild!, 2);
    document.dispatchEvent(new Event("selectionchange"));
    assert(window.getSelection()!.toString().includes(`90 ${prompt}`), "cross-message selection omitted intermediate messages");
    clearSelection();
    await waitFor(() => !selected.isConnected && bodies().length < 180, "clearing selection did not release retained rows");
  });

  return passed;
};

api.prepareNativeSelection = async (theme: string, role: string) => {
  clearSelection();
  document.documentElement.dataset.theme = theme;
  render(<div style={{ padding: 32, width: 850 }}><UserMessage message={user} /><AssistantMessage message={assistant} /></div>);
  await delay();
  const body = document.querySelector<HTMLElement>(`[data-message-body="${role}"]`)!;
  const element = role === "assistant" ? body.querySelector("p")! : body;
  const text = element.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 14);
  const rect = range.getBoundingClientRect();
  const selectionStyle = getComputedStyle(body, "::selection");
  const style = getComputedStyle(body);
  assert(selectionStyle.backgroundColor !== style.backgroundColor, "selection background matches message background");
  assert(style.borderTopWidth === "0px", "message body still has an outer border");
  api.nativeCopyText = null;
  return {
    x1: Math.round(rect.left + 1), x2: Math.round(rect.right - 1), y: Math.round(rect.top + rect.height / 2),
    background: style.backgroundColor, selectionBackground: selectionStyle.backgroundColor,
    selectionForeground: selectionStyle.color,
  };
};

const toolCalls: ToolUseRenderMessage[] = ["git status --short", "git log -1 --oneline"].map((command, index) => ({
  id: `appearance-tool-${index}`, timestamp: new Date(0), type: "tool_use", role: "assistant",
  toolUseId: `appearance-tool-${index}`, toolName: "Bash", displayName: "Bash", input: { command }, status: "success",
}));

api.runAppearanceChecks = async () => {
  clearSelection();
  render(null);
  await delay();
  const passed: string[] = [];
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    for (const content of [reply, `# 标题\n\n${reply}`, `## 标题\n\n${reply}`, `### 标题\n\n${reply}`, "- 第一条内容\n- 第二条内容"]) {
      for (const [chatFontSize, chatLineHeight] of [[12, 1.3], [14, 1.55], [18, 2]]) {
        for (const showAssistantMessageBorder of [false, true]) {
          for (const showAssistantAvatar of [true, false]) {
            render(
              <div style={{ ...getChatAppearanceStyle({ showAssistantMessageBorder, showAssistantAvatar, chatFontSize, chatLineHeight }), padding: 24, width: 850 }}>
                <AssistantMessage message={{ ...assistant, content }} />
              </div>,
            );
            const body = document.querySelector<HTMLElement>('[data-message-body="assistant"]')!;
            const row = document.querySelector<HTMLElement>(".assistant-message")!;
            const avatar = row.querySelector<HTMLElement>(".assistant-message-avatar")!;
            const block = body.querySelector<HTMLElement>(".prose h1, .prose h2, .prose h3, .prose p, .prose li")!;
            assert(getComputedStyle(body).borderTopWidth === (showAssistantMessageBorder ? "1px" : "0px"), "reply border toggle did not apply");
            assert((getComputedStyle(avatar).display !== "none") === showAssistantAvatar, "reply avatar toggle did not apply");
            const indent = body.getBoundingClientRect().left - row.getBoundingClientRect().left;
            assert(Math.abs(indent - (showAssistantAvatar ? 36 : 0)) < 1, `avatar space was not reclaimed: ${indent}`);
            if (showAssistantAvatar) {
              const textCenter = block.getBoundingClientRect().top + parseFloat(getComputedStyle(block).lineHeight) / 2;
              const iconRect = avatar.getBoundingClientRect();
              const difference = Math.abs(textCenter - (iconRect.top + iconRect.height / 2));
              assert(difference < 1, `reply/icon alignment: ${difference}px, ${chatFontSize}/${chatLineHeight}, ${content.slice(0, 8)}`);
            }
          }
        }
      }
    }
  }
  passed.push("reply border/avatar combinations align at all font sizes in both themes");

  const view = (showAssistantMessageBorder: boolean, showAssistantAvatar: boolean) => (
    <div style={getChatAppearanceStyle({ showAssistantMessageBorder, showAssistantAvatar })}>
      <AssistantMessage message={assistant} />
    </div>
  );
  render(view(false, true));
  const paragraph = document.querySelector("p")!;
  const selected = select(paragraph);
  render(view(true, false));
  assert(paragraph.isConnected && window.getSelection()!.toString() === selected, "appearance change replaced selected text");
  clearSelection();
  passed.push("appearance changes preserve Markdown nodes and selected text");

  render(<ToolCallBlock chrome="row" toolCall={toolCalls[0]} />);
  const icon = document.querySelector('[data-row-tool-icon="true"]')!.getBoundingClientRect();
  const title = document.querySelector('[data-tool-call-chrome="row"] button > span')!.getBoundingClientRect();
  assert(Math.abs(icon.top + icon.height / 2 - title.top - title.height / 2) < 1, "Bash text and icon are not centered");
  passed.push("Bash row text is vertically centered with its icon");

  for (const toolDisplayMode of ["merged", "expanded", "collapsed"] as const) {
    for (const showAssistantAvatar of [true, false, true]) {
      render(
        <div style={{ ...getChatAppearanceStyle({ showAssistantAvatar }), padding: 24, width: 850 }}>
          <UserMessage message={user} />
          <AssistantMessage message={assistant} />
          <ThinkingBlock content="检查消息图标和工具显示" />
          <div data-layout-sample="tool"><ToolCallBlock chrome="row" toolCall={toolCalls[0]} /></div>
          <ToolDisplaySettingsProvider toolDisplayMode={toolDisplayMode}>
            <ActivityGroup steps={toolCalls.map((toolCall) => ({ kind: "tool", toolCall }))} toolCalls={toolCalls}
              mergeable resultMap={new Map()} childToolCallsByParent={new Map([[toolCalls[0].toolUseId, [{ ...toolCalls[1], id: "child-tool", toolUseId: "child-tool" }]]])} isLive />
          </ToolDisplaySettingsProvider>
        </div>,
      );
      const icons = [...document.querySelectorAll<HTMLElement>(".chat-message-icon, .assistant-message-avatar")];
      assert(icons.length >= 5, "missing chat icon coverage");
      assert(icons.every((element) => (getComputedStyle(element).display !== "none") === showAssistantAvatar), `icons disagree in ${toolDisplayMode} mode`);
      const userBody = document.querySelector('[data-message-body="user"]')!;
      const userInset = userBody.parentElement!.parentElement!.getBoundingClientRect().right - userBody.getBoundingClientRect().right;
      assert(Math.abs(userInset - (showAssistantAvatar ? 36 : 0)) < 1, "user icon still occupies space");
      const tool = document.querySelector('[data-layout-sample="tool"]')!;
      const toolInset = tool.querySelector('button > span')!.getBoundingClientRect().left - tool.getBoundingClientRect().left;
      assert(Math.abs(toolInset - (showAssistantAvatar ? 36 : 0)) < 1, "tool icon still occupies space");
      const thinking = document.querySelector('[data-thinking-row] > button')!;
      const thinkingInset = thinking.children[1].getBoundingClientRect().left - thinking.parentElement!.getBoundingClientRect().left;
      assert(Math.abs(thinkingInset - (showAssistantAvatar ? 36 : 0)) < 1, "thinking icon still occupies space");
    }
  }
  passed.push("one switch controls user, AI, thinking and nested tool icons in every tool display mode");

  for (const showAssistantMessageBorder of [false, true]) {
    for (const showAssistantAvatar of [false, true]) {
      for (const hasFork of [false, true]) {
        render(
          <div style={{ ...getChatAppearanceStyle({ showAssistantMessageBorder, showAssistantAvatar }), padding: 24, width: 850 }}>
            <AssistantMessage message={assistant} actions={hasFork ? <ForkSessionButton onFork={() => { api.forkClicked = true; }} /> : undefined} />
          </div>,
        );
        const body = document.querySelector('[data-message-body="assistant"]')!;
        const buttons = document.querySelectorAll<HTMLButtonElement>('.assistant-message-actions button');
        const first = buttons[0];
        const left = (showAssistantMessageBorder ? first : first.querySelector('svg')!).getBoundingClientRect().left;
        assert(Math.abs(left - body.getBoundingClientRect().left) < 1, "message actions do not align to frame/text edge");
        const copy = document.querySelector<HTMLButtonElement>('button[aria-label="复制回复"]')!;
        assert(!copy.textContent?.trim(), "copy label should only appear on hover");
        for (let node: Element | null = copy; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          assert(style.opacity !== "0" && style.visibility !== "hidden" && style.display !== "none", "copy button is hidden without hover");
        }
        assert(copy.getBoundingClientRect().height >= 28, "copy click target is too small");
        if (hasFork) {
          const fork = document.querySelector<HTMLButtonElement>('button[aria-label="从最新消息分叉"]')!;
          assert(Math.abs(fork.getBoundingClientRect().top - copy.getBoundingClientRect().top) < 1, "fork and copy buttons are not level");
          api.forkClicked = false;
          fork.click();
          assert(api.forkClicked, "fork action stopped working");
        }
      }
    }
  }
  const copy = document.querySelector<HTMLButtonElement>('button[aria-label="复制回复"]')!;
  copy.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
  await waitFor(() => document.querySelector('[role="tooltip"]')?.textContent === "复制回复", "copy hover tooltip did not appear");
  copy.click();
  await delay();
  assert(api.fixtureClipboard === reply, "copy button did not copy the full reply");
  assert(copy.getAttribute('aria-label') === "已复制", "copy completion feedback did not appear");
  passed.push("persistent copy icon and fork align to the frame/text edge; hover, copy and fork work");

  const { SettingsView } = await import("@/components/settings-view");
  api.agentDesktop = { getManagedRuntimeStatus: async () => null };
  const commits: Partial<DesktopSettings["appearance"]>[] = [];
  function SettingsFixture() {
    const [settings, setSettings] = React.useState<DesktopSettings>({
      agentMode: "local", localEnabled: true, remoteEnabled: false, model: "", maxTurns: 100,
      language: "chinese", thinkingMode: "adaptive", thinkingBudgetTokens: 16000,
      image: { provider: "minimax", url: "", apiKey: "", model: "" },
      appearance: { ...DEFAULT_APPEARANCE },
    } as DesktopSettings);
    const commit = (patch: Partial<DesktopSettings["appearance"]>) => {
      commits.push(patch);
      setSettings((current) => ({ ...current, appearance: normalizeAppearance(patch, current.appearance) }));
    };
    return <div style={{ width: 960, height: 760 }}>
      <SettingsView settingsDraft={settings} setSettingsDraft={setSettings} settingsNotice=""
        autoSaveSettings={async () => {}} autoSaveImageSettings={async () => {}}
        themeMode="light" setThemeMode={() => {}} cssThemeId="default" setCssThemeId={() => {}}
        onToolDisplayModeChange={() => {}} onAppearancePreview={commit} onAppearanceCommit={commit}
        buddyEnabled={false} onBuddyEnabledChange={() => {}} initialSection="appearance" />
    </div>;
  }
  render(<SettingsFixture />);
  await delay();
  assert([...document.querySelectorAll("button")].some((button) => button.textContent === "通用"), "general settings navigation is missing");
  const borderToggle = document.querySelector<HTMLInputElement>('input[aria-label="显示 AI 回复边框"]')!;
  const avatarToggle = document.querySelector<HTMLInputElement>('input[aria-label="显示消息图标"]')!;
  assert(borderToggle && avatarToggle && !borderToggle.checked && avatarToggle.checked, "appearance toggle defaults are incorrect");
  borderToggle.click();
  await delay();
  avatarToggle.click();
  await delay();
  assert(JSON.stringify(commits) === JSON.stringify([{ showAssistantMessageBorder: true }, { showAssistantAvatar: false }]), "appearance switches did not save independent patches");
  const preview = document.querySelector('[aria-label="消息外观预览"]')!;
  assert(getComputedStyle(preview.querySelector('.assistant-message-body')!).borderTopWidth === "1px", "border preview did not update");
  assert(getComputedStyle(preview.querySelector('.assistant-message-avatar')!).display === "none", "avatar preview did not update");
  assert(getComputedStyle(preview.querySelector('.chat-message-icon')!).display === "none", "user avatar preview did not update");
  passed.push("General → Appearance switches save independently and update the live preview");
  render(null);
  return passed;
};

api.prepareAppearancePreview = async (theme: string, showAssistantMessageBorder: boolean, showAssistantAvatar: boolean) => {
  clearSelection();
  document.documentElement.dataset.theme = theme;
  render(
    <div style={{ ...getChatAppearanceStyle({ showAssistantMessageBorder, showAssistantAvatar }), padding: 24, width: 850 }}>
      <UserMessage message={{ ...user, content: "完成以后请说明一下结果。" }} />
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup steps={toolCalls.map((toolCall) => ({ kind: "tool", toolCall }))} toolCalls={toolCalls}
          mergeable resultMap={new Map()} childToolCallsByParent={new Map()} isLive />
      </ToolDisplaySettingsProvider>
      <div style={{ height: 16 }} />
      <AssistantMessage message={{ ...assistant, content: "已完成方案 A。\n\n- 当前工作区已初始化为 Git 仓库\n- 已创建标签：`v0.0.1`\n- 工作区干净\n\n以后可以使用这个版本继续工作。" }} actions={<ForkSessionButton onFork={() => {}} />} />
    </div>,
  );
  await delay();
};
api.selectionFixtureReady = true;
