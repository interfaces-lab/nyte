/** What client code runs from core: part definitions and checks, trace spans, the dev log and iterable helpers. Every module here does no work at import, so a client never loads the kernel's record decoders. */
export { holdMessage } from "./api/hold.ts";

export { fitsActionOutput, fitsAnswer, fitsState } from "./api/part-schema.ts";

export {
  branchSummary,
  compaction,
  definePart,
  isPart,
  text,
  thinking,
  tool,
} from "./contract/parts.ts";

export { callable } from "./util/callable.ts";

export { dev } from "./util/dev-log.ts";

export { closable, coalesce } from "./util/iterable.ts";

export {
  clearSpans,
  enableTracing,
  followTrace,
  followedTrace,
  readSpans,
  SPAN_NAMES,
  startSpan,
  traced,
  tracing,
} from "./util/trace.ts";
