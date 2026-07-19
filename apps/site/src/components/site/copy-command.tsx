"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

interface CopyCommandProps {
  command: string;
  /** Rendered before the `$` prompt as a dimmed hint, e.g. a step label. */
  label?: string;
  className?: string;
}

export function CopyCommand({ command, label, className }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, permissions); the
      // command stays visible for manual selection, so a failure is a no-op.
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Command copied" : `Copy command: ${command}`}
      className={cn(
        "group flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border/60 bg-muted/40 p-3 text-left font-mono text-xs leading-relaxed transition-colors hover:border-primary/40 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {label ? <span className="text-primary/70">{label} </span> : null}
        <span className="text-primary">$</span>{" "}
        <span className="text-foreground">{command}</span>
      </code>
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition-colors group-hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5 text-[var(--chart-2)]" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </span>
    </button>
  );
}
