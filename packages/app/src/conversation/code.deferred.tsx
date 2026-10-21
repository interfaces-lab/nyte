import { publishDeferred } from "../deferred.tsx";
import { DiffView } from "./diff-view.tsx";

export const codeRuntime = { DiffView };

publishDeferred("code", codeRuntime);
