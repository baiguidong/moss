"use client";

import * as React from "react";
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
        "select-none",
        floating
          ? "pointer-events-none absolute top-0 z-10 flex w-auto opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
          : "flex shrink-0",
        floating
          ? align === "end" ? "right-full mr-1.5" : "left-full ml-1.5"
          : align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      <CopyButton
        text={copyText}
        label={copyLabel}
        showLabel={false}
        className="h-7 w-7 justify-center rounded-md border-0 bg-transparent p-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
