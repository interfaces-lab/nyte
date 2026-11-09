import "./login-harness-bridge.ts";
import "../../../test/window-bridge.ts";
import "../../theme/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, ToastStack } from "@nyte-ai/ui/toast";
import { queryClient } from "../../data/query-client.ts";
import { ProvidersSettings } from "../models-settings.tsx";

function Harness(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProvidersSettings />
        <ToastStack />
      </ToastProvider>
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
