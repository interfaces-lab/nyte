import { QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  retainSearchParams,
} from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import dialkit from "dialkit/styles.css?url";
import inter from "@fontsource-variable/inter/opsz.css?url";
import globalCss from "@nyte-ai/app/theme/global.css?url";
import { queryClient } from "@nyte-ai/app/data/query-client.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import dials from "../shell/dials.css?url";
import { LAB_SEARCH_KEYS, readLabSearch } from "../shell/lab-search";
import { LabShell } from "../shell/layout";

/** In dev the StyleX plugin serves its sheet separately; a build appends it to the CSS. */
const dev = import.meta.env.DEV
  ? {
      links: [{ rel: "stylesheet", href: "/virtual:stylex.css" }],
      scripts: [{ type: "module", src: "/@id/virtual:stylex:runtime" }],
    }
  : { links: [], scripts: [] };

export const Route = createRootRoute({
  validateSearch: readLabSearch,
  search: { middlewares: [retainSearchParams([...LAB_SEARCH_KEYS])] },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nyte Lab" },
      { name: "application-name", content: "Nyte Lab" },
      { name: "description", content: "Nyte interface experiments and prototypes." },
    ],
    links: [
      { rel: "stylesheet", href: inter },
      { rel: "stylesheet", href: globalCss },
      { rel: "stylesheet", href: dialkit },
      { rel: "stylesheet", href: dials },
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
        <LabShell>
          <Outlet />
        </LabShell>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
