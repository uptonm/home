import { Code2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#modules", label: "Modules" },
      { href: "/#interface", label: "Interface" },
      { href: "/#operations", label: "Operations" },
      { href: "/#agents", label: "Agent-ready" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/docs", label: "Introduction" },
      { href: "/docs/getting-started", label: "Getting started" },
      { href: "/docs/modules", label: "Modules" },
      { href: "/docs/agent-skills", label: "Agent skills" },
    ],
  },
  {
    title: "Source",
    links: [
      {
        href: siteConfig.githubUrl,
        label: "GitHub repository",
        external: true,
      },
      {
        href: `${siteConfig.githubUrl}/tree/main/apps/home`,
        label: "apps/home",
        external: true,
      },
      {
        href: `${siteConfig.githubUrl}/tree/main/packages/brand`,
        label: "Brand kit",
        external: true,
      },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/15">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
              <Image
                src="/icon-192.png"
                alt=""
                width={24}
                height={24}
                className="rounded-md"
              />
              home
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {siteConfig.shortDescription}
            </p>
            <a
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
            >
              <Code2 className="size-4" aria-hidden />
              github.com/uptonm/home
            </a>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {column.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {siteConfig.author.name}.
          </p>
          <p className="font-mono">
            one CLI · one config root · one module contract
          </p>
        </div>
      </div>
    </footer>
  );
}
