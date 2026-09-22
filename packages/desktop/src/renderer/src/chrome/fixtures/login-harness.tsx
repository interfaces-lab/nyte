/**
 * Settings › Models mounted alone in a real Chromium, over the recorded bridge
 * from ./login-harness-bridge.ts. Host events reach the query cache and the
 * attempt store the way app.tsx routes them.
 */
import "./login-harness-bridge.ts";
import "@nyte-ai/ui/platform-tokens.css";
import "../../theme/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@nyte-ai/ui/sonner";
import { keys, queryClient } from "../../queries.ts";
import { nyte } from "../../nyte.ts";
import { useMountEffect } from "../../use-mount-effect.ts";
import { applyLoginEvent } from "../login-attempts.ts";
import { ModelsSettings } from "../models-settings.tsx";

function Harness(): ReactElement {
  useMountEffect(() =>
    nyte.host.onEvent((event) => {
      if (event.kind === "catalog_changed")
        void queryClient.invalidateQueries({ queryKey: keys.catalog });

      if (event.kind === "login_progress") applyLoginEvent(event);
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ModelsSettings />
      <Toaster containerAriaLabel="Notifications" />
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");

if (root === null) throw new Error("Missing #root");

createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
