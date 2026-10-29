import { publishDeferred } from "../lib/deferred.tsx";
import { highlightCode } from "./highlight-code.ts";

export const highlightRuntime = { highlightCode };

publishDeferred("highlight", highlightRuntime);
