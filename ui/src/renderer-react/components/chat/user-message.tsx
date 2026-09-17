"use client";

import * as React from "react";
import { User } from "lucide-react";
import { FilePreview } from "@/components/file-preview";
import { MessageActionBar } from "@/components/chat/message-action-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { UserTextRenderMessage } from "@/lib/agent-transcript";

export function UserMessage({ message }: { message: UserTextRenderMessage }) {
  const hasText = message.content.trim().length > 0;
  const attachments = message.attachments || [];

  return (
    <div
      className="group flex flex-row-reverse justify-start gap-2"
      style={{ marginBottom: "var(--chat-message-spacing, 10px)" }}
    >
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <User className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>

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

        {hasText && (
          <MessageActionBar
            copyText={message.content}
            copyLabel="复制消息"
            align="end"
            floating
          />
        )}
      </div>
    </div>
  );
}
