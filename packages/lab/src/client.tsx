import "./shell/host-stub";
import "@nyte-ai/app/theme/focus-modality.ts";
import "@nyte-ai/app/conversation/code.deferred.tsx";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
