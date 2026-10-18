import { QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import inter from "@fontsource-variable/inter/opsz.css?url";
import globalCss from "@nyte-ai/app/theme/global.css?url";
import { queryClient } from "@nyte-ai/app/queries.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { LabNav } from "../shell/lab-nav";
import reset from "../shell/reset.css?url";

/** In dev the StyleX plugin serves its sheet separately; a build appends it to the CSS. */
const dev = import.meta.env.DEV
  ? {
      links: [{ rel: "stylesheet", href: "/virtual:stylex.css" }],
      scripts: [
        { type: "module", src: "/src/devtools.ts" },
        { type: "module", src: "/@id/virtual:stylex:runtime" },
      ],
    }
  : { links: [], scripts: [] };

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nyte Labs" },
      { name: "application-name", content: "Nyte Labs" },
      { name: "description", content: "Nyte interface experiments and prototypes." },
    ],
    links: [
      { rel: "stylesheet", href: inter },
      { rel: "stylesheet", href: globalCss },
      { rel: "stylesheet", href: reset },
      ...dev.links,
      { rel: "icon", type: "image/svg+xml", href: "/icon.svg" },
    ],
    scripts: dev.scripts,
  }),
  shellComponent: Document,
  component: LabLayout,
});

function Document({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}

function LabLayout(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Outlet />
        <LabNav />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
