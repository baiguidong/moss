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
            size="icon-sm"
            className="size-7 text-muted-foreground"
            onClick={onFork}
            disabled={forking || Boolean(disabledReason)}
            aria-label="从此处打开新会话"
            aria-busy={forking}
          >
            <GitFork className={cn("size-3.5", forking && "animate-pulse")} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason || "从此处打开新会话"}</TooltipContent>
    </Tooltip>
  );
}
