import "./login-harness-bridge.ts";
import "../../../test/window-bridge.ts";
import "../../theme/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@nyte-ai/ui/toast";
import { queryClient } from "../../queries.ts";
import { ProvidersSettings } from "../models-settings.tsx";

function Harness(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ProvidersSettings />
      <Toaster />
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
