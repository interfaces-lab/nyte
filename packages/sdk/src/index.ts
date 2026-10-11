import { openHost } from "@nyte-ai/host";
import { connect } from "./connect.ts";

export type { OpenHostOptions } from "@nyte-ai/host";
export { memoryJournal } from "./journal.ts";

export * from "./surface.ts";

/**
 * Returns the SDK root: `open` composes a host in-process (host's `openHost`),
 * `connect` reaches one over a URL. Both resolve to the same surface.
 */
export const sdk = { open: openHost, connect };
