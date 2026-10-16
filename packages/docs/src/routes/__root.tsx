import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SelectionHue } from "~/components/selection-hue";
import { appName, siteDescription, siteTitle, siteUrl } from "~/lib/shared";
import { themeScript } from "~/lib/theme";
import globalCss from "~/styles/global.css?url";

/* In dev the StyleX plugin serves its sheet separately; a build appends it to global.css. */
const devStylex = import.meta.env.DEV
  ? {
      links: [{ rel: "stylesheet", href: "/virtual:stylex.css" }],
      scripts: [{ type: "module", src: "/@id/virtual:stylex:runtime" }],
    }
  : { links: [], scripts: [] };

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: siteTitle },
      { name: "description", content: siteDescription },
      { name: "application-name", content: appName },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: appName },
      { property: "og:title", content: siteTitle },
      { property: "og:description", content: siteDescription },
      { property: "og:image", content: `${siteUrl}/opengraph-image.png` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: siteTitle },
      { name: "twitter:description", content: siteDescription },
      { name: "twitter:image", content: `${siteUrl}/opengraph-image.png` },
    ],
    links: [
      // global.css declares the cascade layer order, so it loads before StyleX.
      { rel: "stylesheet", href: globalCss },
      ...devStylex.links,
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-icon.png" },
    ],
    scripts: [{ children: themeScript }, ...devStylex.scripts],
  }),
  shellComponent: RootDocument,
  component: Outlet,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // The theme script sets the class and colour scheme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-svh min-w-0 flex-col bg-background font-sans text-foreground antialiased">
        {children}
        <SelectionHue />
        <Scripts />
      </body>
    </html>
  );
}
