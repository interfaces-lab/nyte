import { publishDeferred } from "../../lib/deferred.tsx";
import { highlightCode, highlightOpenCode, highlightTokens } from "./highlight-code.ts";

export const highlightRuntime = { highlightCode, highlightOpenCode, highlightTokens };

publishDeferred("highlight", highlightRuntime);
