import "./shell/host-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource-variable/inter/opsz.css";
import "@nyte-ai/app/theme/global.css";
import "@nyte-ai/app/theme/focus-modality.ts";
import "./shell/reset.css";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { queryClient } from "@nyte-ai/app/queries.ts";
import { router } from "./router";

const root = document.getElementById("root");

if (root === null) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
