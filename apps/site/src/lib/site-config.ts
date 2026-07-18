export const siteConfig = {
  name: "home",
  title: "home — One CLI for the homelab",
  description:
    "An open-source Bun CLI that gives people and local agents one consistent, guardrailed interface to homelab services, media, cloud tools, and operations.",
  shortDescription:
    "One command surface for homelab services, operations, and agent-ready skills.",
  url: "https://home.uptonm.dev",
  githubUrl: "https://github.com/uptonm/home",
  author: {
    name: "Mike Upton",
    url: "https://uptonm.dev",
  },
  keywords: [
    "homelab CLI",
    "home automation CLI",
    "Bun CLI",
    "TypeScript CLI",
    "local agents",
    "agent skills",
    "Home Assistant CLI",
    "UniFi CLI",
    "UniFi Protect CLI",
    "Sonos CLI",
    "homelab monitoring",
    "developer tools",
  ],
} as const;

export type SiteConfig = typeof siteConfig;
