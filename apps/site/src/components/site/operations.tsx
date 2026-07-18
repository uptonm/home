import { BellRing, Gauge, ScanSearch } from "lucide-react";
import { SectionHeading } from "./section-heading";

const capabilities = [
  {
    icon: ScanSearch,
    title: "Cross-service briefings",
    description:
      "Turn module status into one operational view instead of checking every dashboard by hand.",
  },
  {
    icon: Gauge,
    title: "Structured by default",
    description:
      "Every command can emit JSON, so a shell pipeline and a local model consume the same result.",
  },
  {
    icon: BellRing,
    title: "Mutations stay explicit",
    description:
      "Read widely, then require an intentional --yes before guarded commands can change external state.",
  },
];

export function Operations() {
  return (
    <section
      id="operations"
      className="scroll-mt-14 border-b border-border/60 bg-muted/20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Operations"
          title="Ask the homelab a system-level question."
          description="The useful unit is often not a single API call. home can combine service health, infrastructure pressure, alerts, and availability into the briefing you actually wanted."
        />

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-xl border border-border/60 bg-[#12100e] text-[#f5f1e8] shadow-2xl shadow-black/10">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="size-2.5 rounded-full bg-[#d7a94b]" />
              <span className="size-2.5 rounded-full bg-[#5fb8cb]" />
              <span className="ml-2 font-mono text-xs text-[#aaa097]">
                operational briefing
              </span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-7 sm:p-6">
              <code>
                <span className="text-[#d7a94b]">$</span> home overview ops
                {"\n\n"}
                <span className="text-[#aaa097]">NETWORK</span>
                {"     "}UniFi controller and sites reachable
                {"\n"}
                <span className="text-[#aaa097]">SERVICES</span>
                {"    "}Home Assistant and Protect ready
                {"\n"}
                <span className="text-[#aaa097]">SYSTEMS</span>
                {"     "}Beszel hosts reporting normally
                {"\n"}
                <span className="text-[#aaa097]">AVAILABILITY</span> Uptime Kuma
                has no active incidents
                {"\n\n"}
                <span className="text-[#5fb8cb]">ready</span>
                {"       "}no action required
              </code>
            </pre>
          </div>

          <div className="grid gap-4">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="rounded-xl border border-border/60 bg-card/60 p-5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/[0.08]">
                    <capability.icon
                      className="size-4.5 text-primary"
                      aria-hidden
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold">{capability.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {capability.description}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
