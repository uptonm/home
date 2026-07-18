import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "home — One CLI for the homelab",
    short_name: "home",
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: "#12100e",
    theme_color: "#12100e",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
