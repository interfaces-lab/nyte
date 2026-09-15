import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { DialRoot } from "dialkit";
import { createRoot } from "react-dom/client";
import { queryClient } from "./queries.ts";
import { router } from "./router.tsx";
import "react-grab";
import "dialkit/styles.css";

const host = document.createElement("div");
document.body.append(host);

createRoot(host).render(
  <>
    <TanStackDevtools
      plugins={[
        { name: "Query", render: <ReactQueryDevtoolsPanel client={queryClient} /> },
        { name: "Router", render: <TanStackRouterDevtoolsPanel router={router} /> },
      ]}
    />
    <DialRoot />
  </>,
);
