"use client";

import * as React from "react";
import { FilePreview } from "@/components/file-preview";
import type { UserTextRenderMessage } from "@/lib/agent-transcript";

export function UserMessage({ message }: { message: UserTextRenderMessage }) {
  const hasText = message.content.trim().length > 0;
  const attachments = message.attachments || [];

  return (
    <div
      className="group flex flex-row-reverse justify-start gap-2"
      style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}
    >
      <img
        src="./build/icon.png"
        alt="用户"
        className="h-7 w-7 shrink-0 self-start rounded-sm object-contain"
      />

      <div
        data-message-shell="user"
        className="relative flex max-w-[82%] min-w-0 flex-col items-end gap-1 sm:max-w-[78%] lg:max-w-[72%]"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {attachments.map((attachment) => (
              <FilePreview
                key={`${attachment.kind}:${attachment.path}`}
                path={attachment.path}
                name={attachment.name}
                readonly
              />
            ))}
          </div>
        )}

        {hasText && (
          <div
            className="max-w-full whitespace-pre-wrap break-words rounded-xl rounded-tr-[4px] bg-primary px-3 text-primary-foreground"
            style={{
              fontSize: "var(--chat-font-size, 14px)",
              lineHeight: "var(--chat-line-height, 1.55)",
              paddingBlock: "var(--chat-bubble-padding-y, 8px)",
            }}
          >
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}
