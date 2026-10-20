import { publishDeferred } from "../deferred.tsx";
import { highlightCode } from "../pierre-worker-provider.tsx";
import { DiffView } from "./diff-view.tsx";

export const codeRuntime = { DiffView, highlightCode };

publishDeferred("code", codeRuntime);
