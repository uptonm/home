import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
  images: {
    // Static export-friendly; no remote images are used on the site.
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        // Short install command: `curl -fsSL home.uptonm.dev/install.sh | bash`.
        // The canonical installer lives in scripts/install.sh; redirect keeps a
        // single source of truth. 307 leaves the target repointable later.
        source: "/install.sh",
        destination:
          "https://raw.githubusercontent.com/uptonm/home/main/scripts/install.sh",
        permanent: false,
      },
    ];
  },
};

export default withMDX(nextConfig);
