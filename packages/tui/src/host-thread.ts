import { compiled } from "./compiled.ts";

export const HOST_WORKER = compiled
  ? "./tui/src/host-worker.ts"
  : new URL("./host-worker.ts", import.meta.url);
