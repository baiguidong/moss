"use client";

import * as React from "react";
import type { OpenFileViewerProps } from "./OpenFileViewer";

const OpenFileViewer = React.lazy(() => import("./OpenFileViewer"));

export function LazyOpenFileViewer(props: OpenFileViewerProps) {
  return (
    <React.Suspense
      fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载扩展解析器...</div>}
    >
      <OpenFileViewer {...props} />
    </React.Suspense>
  );
}
