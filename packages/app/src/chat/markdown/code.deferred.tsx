import { publishDeferred } from "../../lib/deferred.tsx";
import { DiffView } from "../../diff/diff-view.tsx";

export const codeRuntime = { DiffView };

publishDeferred("code", codeRuntime);
