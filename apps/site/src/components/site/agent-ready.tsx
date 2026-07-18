import { Bot, FileCode2, LockKeyhole, RefreshCw } from "lucide-react";
import { SectionHeading } from "./section-heading";

const features = [
  {
    icon: FileCode2,
    title: "Skills generated from code",
    text: "The same manifests that define the CLI generate one focused skill per module, so agent instructions do not drift from the actual command surface.",
  },
  {
    icon: LockKeyhole,
    title: "Secrets stay in the local boundary",
    text: "Configuration lives under one root and supports the platform keyring, encrypted files, or environment-backed secrets without putting credentials in prompts.",
  },
  {
    icon: RefreshCw,
    title: "Predictable machine contracts",
    text: "Stable JSON, error codes, and explicit mutation guards let an agent recover from failures and know when it must ask before acting.",
  },
];

export function AgentReady() {
  return (
    <section
      id="agents"
      className="scroll-mt-14 border-b border-border/60 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.045] p-6 sm:p-10">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <div className="flex size-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                <Bot className="size-5 text-primary" aria-hidden />
              </div>
              <SectionHeading
                className="mt-6"
                eyebrow="Agent-ready"
                title="A tool an agent can use without pretending the world is read-only."
                description="home is designed around the awkward parts of local automation: credentials, changing APIs, partial failures, and actions that should never happen silently."
              />
            </div>

            <div className="grid gap-4">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-xl border border-border/60 bg-background/65 p-5"
                >
                  <div className="flex gap-4">
                    <feature.icon
                      className="mt-0.5 size-5 shrink-0 text-[var(--chart-2)]"
                      aria-hidden
                    />
                    <div>
                      <h3 className="font-semibold">{feature.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {feature.text}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
