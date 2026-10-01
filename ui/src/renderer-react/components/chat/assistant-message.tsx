"use client";

import * as React from "react";
import { FilePreview } from "@/components/file-preview";
import { MessageActionBar } from "@/components/chat/message-action-bar";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import type { AssistantTextRenderMessage } from "@/lib/agent-transcript";
import { AssistantOutputFileCard } from "@/components/chat/assistant-output-file-card";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";

function shouldUseDocumentLayout(content: string, attachmentCount: number) {
  const normalized = content.trim();
  if (attachmentCount > 0) return true;
  if (!normalized) return false;
  if (/```/.test(normalized)) return true;
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true;

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return paragraphs.length >= 2 || normalized.split("\n").filter((line) => line.trim()).length >= 8;
}

export const AssistantMessage = React.memo(function AssistantMessage({
  message,
  beforeContent,
  actions,
  showCopyButton = true,
  outputFiles = [],
  sessionId,
  workspace,
  remote,
}: {
  message: AssistantTextRenderMessage;
  beforeContent?: React.ReactNode;
  actions?: React.ReactNode;
  showCopyButton?: boolean;
  outputFiles?: AssistantOutputFile[];
  sessionId?: string;
  workspace?: string;
  remote?: boolean;
}) {
  const attachments = (message.attachments || []).filter((attachment) => !outputFiles.some((file) => file.path === attachment.path || file.sourcePaths.includes(attachment.path)));
  const hasText = message.content.trim().length > 0;
  const documentLayout = shouldUseDocumentLayout(message.content, attachments.length + outputFiles.length);
  const copyAction = showCopyButton && hasText ? (
    <MessageActionBar
      copyText={message.content}
      copyLabel="复制回复"
      align="start"
      className="min-h-7"
    />
  ) : null;

  return (
    <div
      className="assistant-message group flex items-start justify-start gap-2"
      style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}
    >
      <img
        src="./build/icon.png"
        alt="Moss"
        className="assistant-message-avatar h-7 w-7 shrink-0 self-start rounded-sm object-contain"
        draggable={false}
      />
      <div
        data-message-shell="assistant"
        data-layout={documentLayout ? "document" : "bubble"}
        className="relative flex w-full min-w-0 flex-col items-start gap-2"
      >
        {beforeContent}

        {(hasText || attachments.length > 0) && (
          <div data-message-body="assistant" className="assistant-message-body w-full min-w-0 max-w-full text-foreground select-text">
            {hasText && (
              <MarkdownRenderer
                content={message.content}
                variant={documentLayout ? "document" : "default"}
                sourceId={message.id}
                chatDensity
              />
            )}

            {attachments.length > 0 && (
              <div className={hasText ? "mt-3 flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
                {attachments.map((attachment) => (
                  <FilePreview
                    key={`${attachment.kind}:${attachment.path}`}
                    path={attachment.path}
                    readonly
                  />
                ))}
              </div>
            )}

            {message.streaming && hasText && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-text-bottom" />
            )}

            {message.meta && message.meta.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {message.meta.map((entry) => (
                  <span
                    key={entry}
                    className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {entry}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {!message.streaming && outputFiles.length > 0 && (
          <div className="flex w-full flex-col gap-2" aria-label="文件">
            {outputFiles.map((file) => <AssistantOutputFileCard key={file.path} file={file} sessionId={sessionId} workspace={workspace} remote={remote} />)}
          </div>
        )}

        {actions || copyAction ? (
          <div className="assistant-message-actions -mt-1 flex min-h-7 items-center gap-1">
            {actions}
            {copyAction}
          </div>
        ) : null}
      </div>
    </div>
  );
});
