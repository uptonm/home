"use client";

import { Code2, Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { siteConfig } from "@/lib/site-config";
import { ThemeToggle } from "./theme-toggle";

const navLinks = [
  { href: "/#modules", label: "Modules" },
  { href: "/#interface", label: "Interface" },
  { href: "/#operations", label: "Operations" },
  { href: "/#agents", label: "Agents" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight"
        >
          <Image
            src="/icon-192.png"
            alt=""
            width={24}
            height={24}
            priority
            className="rounded-md"
          />
          home
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 text-sm text-muted-foreground md:flex"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: The icon button has an aria-label and Base UI merges it into this anchor.
              <a
                href={siteConfig.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="home on GitHub"
              />
            }
          >
            <Code2 className="size-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            className="hidden sm:inline-flex"
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: Base UI merges the button's visible children into this anchor.
              <a href="/docs/getting-started" />
            }
          >
            Get started
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              }
            />
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="font-mono">home</SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ))}
                <a
                  href={siteConfig.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-2 rounded-md px-2 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <Code2 className="size-4" aria-hidden />
                  GitHub
                </a>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
