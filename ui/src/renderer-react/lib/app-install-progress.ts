import * as React from "react";
import type { AppInstallProgress } from "../types";

export function isAppInstallActive(progress?: AppInstallProgress) {
  return Boolean(progress && !["completed", "error", "canceled"].includes(progress.phase));
}

export function useAppInstallProgress(source: AppInstallProgress["source"]) {
  const [progress, setProgress] = React.useState<Record<string, AppInstallProgress | undefined>>({});

  React.useEffect(() => {
    let disposed = false;
    const key = (value: AppInstallProgress) => source === "local" ? "local" : value.appId;
    const unsubscribe = window.agentDesktop.onAppInstallProgress((value) => {
      if (value.source === source) setProgress((current) => ({ ...current, [key(value)]: value }));
    });
    // Restore ongoing installs after navigating away; live events take precedence over the snapshot.
    void window.agentDesktop.getAppInstallProgress().then((snapshot) => {
      if (disposed) return;
      const initial = Object.fromEntries(snapshot.filter((value) => value.source === source).map((value) => [key(value), value]));
      setProgress((current) => ({ ...initial, ...current }));
    }).catch(() => {});
    return () => { disposed = true; unsubscribe(); };
  }, [source]);

  const clearProgress = (key: string) => setProgress((current) => ({ ...current, [key]: undefined }));
  return { progress, clearProgress };
}
