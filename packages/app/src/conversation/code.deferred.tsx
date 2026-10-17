import { publishDeferred } from "../deferred.tsx";
import { highlightCode } from "../pierre-worker-provider.tsx";
import { DiffView } from "./diff-view.tsx";

/** Pierre's diff rendering for transcript edits, and its highlighting for fenced code. */
export const codeRuntime = { DiffView, highlightCode };

publishDeferred("code", codeRuntime);
