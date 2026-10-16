import { publishDeferred } from "../deferred.tsx";
import { DiffView } from "./diff-view.tsx";

/** Pierre's diff rendering for transcript edits. */
export const codeRuntime = { DiffView };

publishDeferred("code", codeRuntime);
