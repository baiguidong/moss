"use client";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/shared/copy-button";

export function MessageActionBar({
  copyText,
  copyLabel,
  align = "start",
  className,
  floating = false,
}: {
  copyText?: string;
  copyLabel?: string;
  align?: "start" | "end";
  className?: string;
  floating?: boolean;
}) {
  if (!copyText) return null;

  return (
    <div
      className={cn(
        floating
          ? "pointer-events-none absolute top-0 z-10 flex w-auto opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
          : "flex w-full opacity-0 transition-opacity duration-150 group-hover:opacity-100",
        floating
          ? align === "end" ? "right-full mr-1.5" : "left-full ml-1.5"
          : align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      <CopyButton text={copyText} label={copyLabel} showLabel={!floating} />
    </div>
  );
}
