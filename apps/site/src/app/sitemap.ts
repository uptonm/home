import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const docsPages: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${siteConfig.url}${page.url}`,
    changeFrequency: "monthly",
    priority: page.url === "/docs" ? 0.9 : 0.75,
  }));

  return [
    {
      url: siteConfig.url,
      changeFrequency: "weekly",
      priority: 1,
      images: [`${siteConfig.url}/og.png`],
    },
    ...docsPages,
  ];
}
