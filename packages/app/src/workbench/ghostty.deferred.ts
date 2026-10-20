import { publishDeferred } from "../deferred.tsx";
import { loadGhostty } from "./ghostty.ts";

export const ghosttyRuntime = { loadGhostty };

publishDeferred("ghostty", ghosttyRuntime);
