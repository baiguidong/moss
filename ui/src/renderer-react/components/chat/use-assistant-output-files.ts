import * as React from "react";
import type { TranscriptRenderMessage } from "@/lib/agent-transcript";
import {
  collectAssistantOutputCandidates,
  resolveAssistantOutputFiles,
  type AssistantOutputFile,
  type OutputCandidate,
} from "@/lib/assistant-output-files";

const emptyFiles = new Map<string, AssistantOutputFile[]>();

export function useAssistantOutputFiles(
  messages: TranscriptRenderMessage[],
  sessionId?: string,
  agentMode?: "local" | "remote-direct",
  workspace?: string,
  loading?: boolean,
) {
  // Depend on the small candidate projection, not each streamed text token.
  const candidatesJson = React.useMemo(() => JSON.stringify([...collectAssistantOutputCandidates(messages)]), [messages]);
  const requestKey = JSON.stringify([sessionId, agentMode, workspace, Boolean(loading), candidatesJson]);
  const [resolved, setResolved] = React.useState<{ key: string; files: Map<string, AssistantOutputFile[]> }>();

  React.useEffect(() => {
    if (!sessionId || agentMode === "remote-direct") return;
    let cancelled = false;
    const candidates = new Map<string, OutputCandidate[]>(JSON.parse(candidatesJson));
    void resolveAssistantOutputFiles(candidates, sessionId, (payload) => window.agentDesktop.preview.resolveFiles(payload))
      .then((files) => { if (!cancelled) setResolved({ key: requestKey, files }); })
      .catch(() => { if (!cancelled) setResolved({ key: requestKey, files: emptyFiles }); });
    return () => { cancelled = true; };
  }, [sessionId, agentMode, candidatesJson, requestKey]);

  // Invalidate immediately on a session/turn change, before effects run.
  return resolved?.key === requestKey ? resolved.files : emptyFiles;
}
