import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

/**
 * Shared layout configuration for both the marketing shell (via the site
 * header) and the fumadocs docs layout, so branding stays in one place.
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="flex items-center gap-2 font-mono font-semibold tracking-tight">
        <Image
          src="/icon-192.png"
          alt=""
          width={22}
          height={22}
          className="rounded-md"
        />
        home
      </span>
    ),
  },
  links: [
    { text: "Modules", url: "/#modules" },
    { text: "Interface", url: "/#interface" },
    { text: "Agents", url: "/#agents" },
    { text: "Docs", url: "/docs" },
    {
      text: "GitHub",
      url: "https://github.com/uptonm/home",
      external: true,
    },
  ],
};
