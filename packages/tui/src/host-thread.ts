import { compiled } from "./compiled.ts";

/** The host worker of this build: the compiled binary serves its modules from Bun's virtual filesystem. */
export const HOST_WORKER = compiled
  ? "./tui/src/host-worker.ts"
  : new URL("./host-worker.ts", import.meta.url);
