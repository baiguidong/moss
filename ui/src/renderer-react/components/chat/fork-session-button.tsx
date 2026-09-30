import { GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ForkSessionButton({
  onFork,
  forking = false,
  disabledReason,
}: {
  onFork: () => void;
  forking?: boolean;
  disabledReason?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-[7px] has-[>svg]:px-[7px] text-xs text-muted-foreground"
            onClick={onFork}
            disabled={forking || Boolean(disabledReason)}
            aria-label="从最新消息分叉"
          >
            <GitFork className={cn("size-3.5", forking && "animate-pulse")} />
            {forking ? "正在分叉…" : "分叉"}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason || "从最新消息分叉"}</TooltipContent>
    </Tooltip>
  );
}
