import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { DialRoot } from "dialkit";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@nyte-ai/ui/button";
import { queryClient, setUpdateStateForDemo } from "@nyte-ai/app";
import type { UpdateState } from "@nyte-ai/app";
import { router } from "./main.tsx";
import "react-grab";
import "dialkit/styles.css";

const UPDATE_DEMO: readonly UpdateState[] = [
  { kind: "idle" },
  { kind: "downloading", version: "0.3.0", percent: 42 },
  { kind: "ready", version: "0.3.0" },
  { kind: "blocked", version: "0.3.0", taskCount: 2, terminalCommandCount: 1 },
  { kind: "failed", version: "0.3.0", message: "Checksum mismatch" },
];

function UpdateDemoPanel() {
  const [active, setActive] = useState<UpdateState["kind"]>("idle");

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12 }}>
      {UPDATE_DEMO.map((state) => (
        <Button
          key={state.kind}
          size="sm"
          variant={state.kind === active ? "solid" : "outline"}
          onClick={() => {
            setActive(state.kind);
            setUpdateStateForDemo(state);
          }}
        >
          {state.kind}
        </Button>
      ))}
    </div>
  );
}

const host = document.createElement("div");

document.body.append(host);

createRoot(host).render(
  <>
    <TanStackDevtools
      plugins={[
        { name: "Query", render: <ReactQueryDevtoolsPanel client={queryClient} /> },
        { name: "Router", render: <TanStackRouterDevtoolsPanel router={router} /> },
        { name: "Update", render: <UpdateDemoPanel /> },
      ]}
    />
    <DialRoot />
  </>,
);
