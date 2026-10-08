import type { CSSProperties } from "react";
import type { DesktopSettings } from "@/types";

export function getChatAppearanceStyle(appearance?: Partial<DesktopSettings["appearance"]>): CSSProperties {
  const bordered = appearance?.showAssistantMessageBorder ?? false;
  // Keep the persisted key so existing icon preferences also apply to all chat roles.
  const showAvatar = appearance?.showAssistantAvatar ?? true;
  return {
    "--chat-font-size": `${appearance?.chatFontSize ?? 14}px`,
    "--chat-line-height": appearance?.chatLineHeight ?? 1.55,
    "--chat-message-spacing": `${appearance?.chatMessageSpacing ?? 10}px`,
    "--chat-bubble-padding-y": `${Math.max(6, Math.min(12, Math.round((appearance?.chatMessageSpacing ?? 10) * 0.5 + 3)))}px`,
    "--assistant-avatar-display": showAvatar ? "block" : "none",
    "--chat-icon-display": showAvatar ? "flex" : "none",
    "--assistant-avatar-size": showAvatar ? "28px" : "0px",
    "--assistant-content-inset": showAvatar ? "36px" : "0px",
    "--assistant-message-border-width": bordered ? "1px" : "0px",
    "--assistant-message-padding-x": bordered ? "16px" : "0px",
    "--assistant-message-padding-y": bordered ? "10px" : "0px",
    "--assistant-message-background": bordered ? "var(--card)" : "transparent",
    "--assistant-message-actions-offset": bordered ? "0px" : "-7px",
  } as CSSProperties;
}
