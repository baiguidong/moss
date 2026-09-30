import * as React from 'react';
import { Workflow } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function SessionTraceButton({ session, onOpen }: {
  session: { id: string; underlyingSessionId?: string | null; agentMode?: string } | null;
  onOpen: (sessionId: string, target: 'local' | 'remote') => void;
}) {
  if (!session) return null;
  const remote = session.agentMode === 'remote-direct';
  const id = remote ? session.underlyingSessionId : session.id;
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full"
        aria-label="查看会话 Trace" disabled={!id} onClick={() => { if (id) onOpen(id, remote ? 'remote' : 'local'); }}>
        <Workflow className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>查看会话 Trace</TooltipContent>
  </Tooltip>;
}
