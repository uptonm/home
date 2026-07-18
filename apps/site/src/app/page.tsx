import { AgentReady } from "@/components/site/agent-ready";
import { Hero } from "@/components/site/hero";
import { Install } from "@/components/site/install";
import { ModuleGrid } from "@/components/site/module-grid";
import { Operations } from "@/components/site/operations";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { UnifiedInterface } from "@/components/site/unified-interface";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <ModuleGrid />
        <UnifiedInterface />
        <Operations />
        <AgentReady />
        <Install />
      </main>
      <SiteFooter />
    </>
  );
}
