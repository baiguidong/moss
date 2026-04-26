"use client";

import { FilePreview } from "@/components/file-preview";
import { MessageActionBar } from "@/components/chat/message-action-bar";
import type { UserTextRenderMessage } from "@/lib/agent-transcript";

export function UserMessage({ message }: { message: UserTextRenderMessage }) {
  const hasText = message.content.trim().length > 0;
  const attachments = message.attachments || [];

  return (
    <div className="group mb-5 flex justify-end">
      <div
        data-message-shell="user"
        className="flex w-full max-w-[82%] min-w-0 flex-col items-end gap-2 sm:max-w-[78%] lg:max-w-[72%]"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {attachments.map((attachment) => (
              <FilePreview
                key={`${attachment.kind}:${attachment.path}`}
                path={attachment.path}
                readonly
              />
            ))}
          </div>
        )}

        {hasText && (
          <div className="max-w-full whitespace-pre-wrap break-words rounded-[18px] rounded-tr-[4px] bg-primary px-4 py-3 text-sm leading-7 text-primary-foreground">
            {message.content}
          </div>
        )}

        {hasText && (
          <MessageActionBar
            copyText={message.content}
            copyLabel="复制消息"
            align="end"
          />
        )}
      </div>
    </div>
  );
}
