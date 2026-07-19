import {
  ArrowRight,
  Download,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { CopyCommand } from "./copy-command";
import { SectionHeading } from "./section-heading";

const steps = [
  {
    icon: Download,
    title: "Install the binary",
    command: siteConfig.installCommand,
  },
  {
    icon: SlidersHorizontal,
    title: "Configure what you use",
    command: "home init && home configure",
  },
  {
    icon: Sparkles,
    title: "Give your agent the same surface",
    command: "home skill install",
  },
];

export function Install() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Get started"
          title="From zero to a ready command surface."
          description="Install one binary, configure only the modules you use, and generate the local skills when you want an agent to operate through the same interface."
          align="center"
        />

        <ol className="mt-12 grid gap-4 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-card/60 p-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/[0.08]">
                  <step.icon className="size-4 text-primary" aria-hidden />
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-5 font-semibold">{step.title}</h3>
              <CopyCommand command={step.command} className="mt-4" />
            </li>
          ))}
        </ol>

        <div className="mt-10 flex justify-center">
          <Button
            size="lg"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: Base UI merges the button's visible children into this anchor.
              <a href="/docs/getting-started" />
            }
          >
            Read the installation guide
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
