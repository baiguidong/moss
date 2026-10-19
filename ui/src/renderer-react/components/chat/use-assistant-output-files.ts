import * as React from "react";
import type { TranscriptRenderMessage } from "@/lib/agent-transcript";
import type { PresentationResource, TurnChangeSummary } from '@/types';
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
  const scope = JSON.stringify([sessionId, agentMode, workspace]);
  const turnKey = messages.filter(message => message.type === 'user_text').map(message => message.turnId || message.id).join(':');
  const [evidence, setEvidence] = React.useState<{ scope: string; resources: PresentationResource[]; turns: TurnChangeSummary[] }>();
  React.useEffect(() => {
    if (!sessionId || agentMode === 'remote-direct') return;
    let active = true, revision = 0, resourceRevision = 0;
    const host = window.agentDesktop;
    const refresh = async () => {
      const current = ++revision;
      const resourcesAtStart = resourceRevision;
      const [snapshot, changes] = await Promise.allSettled([host.presentation?.snapshot({ sessionId }), host.getTurnChanges?.({ sessionId })]);
      if (!active || current !== revision) return;
      setEvidence(previous => ({ scope,
        resources: previous?.scope === scope && resourcesAtStart !== resourceRevision ? previous.resources : snapshot.status === 'fulfilled' ? snapshot.value?.resources || [] : [],
        turns: changes.status === 'fulfilled' ? changes.value?.turns || [] : [],
      }));
    };
    void refresh();
    const offResources = host.presentation?.onChanged(snapshot => {
      if (!active || snapshot.sessionId !== sessionId) return;
      resourceRevision++;
      setEvidence(previous => ({ scope, resources: snapshot.resources, turns: previous?.scope === scope ? previous.turns : [] }));
    });
    const offChanges = host.onTurnObservation?.(event => { if (event.sessionId === sessionId) void refresh(); });
    return () => { active = false; offResources?.(); offChanges?.(); };
  }, [scope, turnKey, loading]);
  // Depend on the small candidate projection, not each streamed text token.
  const candidatesJson = React.useMemo(() => JSON.stringify([...collectAssistantOutputCandidates(messages, evidence?.scope === scope ? evidence : undefined)]), [messages, evidence, scope]);
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
