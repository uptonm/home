import { Activity, Bot, Cloud, HousePlug, Music2, Network } from "lucide-react";
import { SectionHeading } from "./section-heading";

const groups = [
  {
    icon: HousePlug,
    title: "Home & network",
    description: "Control the physical systems that make the homelab useful.",
    modules: ["unifi", "protect", "assistant"],
  },
  {
    icon: Music2,
    title: "Media",
    description: "Search, play, group, and announce across the house.",
    modules: ["spotify", "sonos", "tts"],
  },
  {
    icon: Cloud,
    title: "Cloud & communication",
    description: "Read the services that connect home life to the wider world.",
    modules: ["google", "gmail", "gcal", "gdrive", "discord"],
  },
  {
    icon: Bot,
    title: "Developer workflow",
    description:
      "Inspect code, stacks, planning, and deployments from one tool.",
    modules: ["github", "graphite", "linear", "vercel"],
  },
  {
    icon: Activity,
    title: "Operations",
    description:
      "Bring infrastructure health and availability into one briefing.",
    modules: ["beszel", "uptime-kuma"],
  },
];

export function ModuleGrid() {
  return (
    <section
      id="modules"
      className="scroll-mt-14 border-b border-border/60 bg-muted/20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow="17 modules"
            title="Your services already speak different languages. You don't have to."
            description="Every adapter keeps the service-specific detail where it belongs, then exposes the same command shape, structured output, and error model at the surface."
          />
          <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-2 font-mono text-xs text-muted-foreground md:flex">
            <Network className="size-3.5 text-[var(--chart-2)]" aria-hidden />
            one registry · one config root
          </div>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          {groups.map((group, index) => (
            <article
              key={group.title}
              className={
                index < 2
                  ? "rounded-xl border border-border/60 bg-card/60 p-6 lg:col-span-3"
                  : "rounded-xl border border-border/60 bg-card/60 p-6 lg:col-span-2"
              }
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/[0.08]">
                <group.icon className="size-5 text-primary" aria-hidden />
              </div>
              <h3 className="mt-5 font-semibold tracking-tight">
                {group.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {group.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {group.modules.map((module) => (
                  <code
                    key={module}
                    className="rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-xs text-foreground"
                  >
                    {module}
                  </code>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
