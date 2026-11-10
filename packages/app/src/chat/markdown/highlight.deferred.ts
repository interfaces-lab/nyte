import { publishDeferred } from "../../lib/deferred.tsx";
import {
  finishCode,
  highlightCode,
  highlightTokens,
  openCodeStream,
  streamCode,
} from "./highlight-code.ts";

export const highlightRuntime = {
  finishCode,
  highlightCode,
  highlightTokens,
  openCodeStream,
  streamCode,
};

publishDeferred("highlight", highlightRuntime);
