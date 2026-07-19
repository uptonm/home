import { ArrowRight, Check, Code2, Terminal } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { CopyCommand } from "./copy-command";

const statusRows = [
  ["unifi", "ready"],
  ["protect", "ready"],
  ["assistant", "ready"],
  ["beszel", "ready"],
  ["uptime-kuma", "ready"],
];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="terminal-grid pointer-events-none absolute inset-0 opacity-35 [mask-image:radial-gradient(ellipse_80%_70%_at_68%_36%,black_20%,transparent_75%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-14rem] left-[32%] h-[28rem] w-[28rem] rounded-full bg-[var(--chart-2)]/10 blur-[140px]"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:py-32">
        <div>
          <Badge
            variant="outline"
            className="rounded-full border-primary/35 bg-primary/[0.06] px-3 py-1 font-mono text-xs text-primary"
          >
            v1.1.0 · 17 service modules
          </Badge>

          <div className="mt-7 flex items-center gap-4">
            <Image
              src="/icon-192.png"
              alt="home"
              width={64}
              height={64}
              priority
              className="size-14 rounded-xl sm:size-16"
            />
            <span className="font-mono text-5xl font-semibold tracking-tighter sm:text-6xl">
              home
            </span>
          </div>

          <h1 className="mt-7 max-w-xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            One CLI for the homelab.
          </h1>
          <p className="mt-5 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
            A consistent, scriptable command surface across home automation,
            network infrastructure, media, cloud tools, and operations — built
            for you at the terminal and for local agents behind the scenes.
          </p>

          <div className="mt-8 max-w-xl">
            <CopyCommand command={siteConfig.installCommand} />
            <p className="mt-2 text-xs text-muted-foreground">
              Click to copy · installs the single binary on macOS and Linux
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              nativeButton={false}
              render={
                // biome-ignore lint/a11y/useAnchorContent: Base UI merges the button's visible children into this anchor.
                <a href="/docs/getting-started" />
              }
            >
              Read the docs
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={
                // biome-ignore lint/a11y/useAnchorContent: Base UI merges the button's visible children into this anchor.
                <a
                  href={siteConfig.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Code2 className="size-4" aria-hidden />
              View source
            </Button>
          </div>

          <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["Single binary", "JSON everywhere", "Guarded writes"].map(
              (item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary" aria-hidden />
                  {item}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="signal-glow overflow-hidden rounded-2xl border border-border/70 bg-card/80 backdrop-blur">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" aria-hidden />
              <span className="font-mono text-xs text-muted-foreground">
                home status
              </span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--chart-2)]">
              local
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="font-mono text-sm">
              <span className="text-primary">$</span>{" "}
              <span className="text-foreground">home status</span>
            </div>
            <div className="mt-5 space-y-3">
              {statusRows.map(([name, status], index) => (
                <div
                  key={name}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 font-mono text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{name}</span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[var(--chart-2)]">
                    <span className="size-1.5 rounded-full bg-current" />
                    {status}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-border/60 pt-5 font-mono text-xs leading-relaxed">
              <p>
                <span className="text-primary">$</span> home overview ops --json
              </p>
              <p className="mt-2 text-muted-foreground">
                {"{"}{" "}
                <span className="text-[var(--chart-2)]">&quot;ok&quot;</span>:
                true, <span className="text-primary">&quot;modules&quot;</span>:
                17 {"}"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
