import { publishDeferred } from "../deferred.tsx";
import { loadGhostty } from "./ghostty.ts";

/** The terminal engine on its own, so idle time can compile its wasm before the first terminal opens. */
export const ghosttyRuntime = { loadGhostty };

publishDeferred("ghostty", ghosttyRuntime);
