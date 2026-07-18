import { ArrowDown, Braces, ShieldCheck, TerminalSquare } from "lucide-react";
import { SectionHeading } from "./section-heading";

const layers = [
  {
    label: "Command surface",
    detail: "human-readable output · --json · completion",
    accent: "text-primary",
  },
  {
    label: "Module registry",
    detail: "commands · configuration · generated skills",
    accent: "text-[var(--chart-2)]",
  },
  {
    label: "Service adapters",
    detail: "authentication · API quirks · normalized errors",
    accent: "text-foreground",
  },
];

export function UnifiedInterface() {
  return (
    <section
      id="interface"
      className="scroll-mt-14 border-b border-border/60 py-20 sm:py-28"
    >
      <div className="mx-auto grid max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading
          eyebrow="One interface"
          title="Service differences stay below the command line."
          description="The module contract is the source of truth for commands, configuration, status, and generated agent skills. That means a new integration plugs into the same behavior instead of inventing another mini-CLI."
        />

        <div className="rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-7">
          {layers.map((layer, index) => (
            <div key={layer.label} className="flex flex-col items-center">
              <div className="w-full rounded-xl border border-border/60 bg-background/70 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3
                    className={`font-mono text-sm font-semibold ${layer.accent}`}
                  >
                    {layer.label}
                  </h3>
                  {index === 0 ? (
                    <TerminalSquare
                      className="size-4 text-primary"
                      aria-hidden
                    />
                  ) : index === 1 ? (
                    <Braces
                      className="size-4 text-[var(--chart-2)]"
                      aria-hidden
                    />
                  ) : (
                    <ShieldCheck className="size-4" aria-hidden />
                  )}
                </div>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {layer.detail}
                </p>
              </div>
              {index < layers.length - 1 ? (
                <ArrowDown
                  className="my-2 size-4 text-muted-foreground/60"
                  aria-hidden
                />
              ) : null}
            </div>
          ))}

          <div className="mt-3 grid grid-cols-3 gap-2 text-center font-mono text-[11px] text-muted-foreground">
            {["LAN", "cloud", "local tools"].map((target) => (
              <span
                key={target}
                className="rounded-md border border-border/60 bg-muted/40 px-2 py-2"
              >
                {target}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
