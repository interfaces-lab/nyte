import { publishDeferred } from "../../lib/deferred.tsx";
import { highlightCode, highlightTokens } from "./highlight-code.ts";

export const highlightRuntime = { highlightCode, highlightTokens };

publishDeferred("highlight", highlightRuntime);
