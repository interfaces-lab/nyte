import type { SessionId } from "@nyte-ai/schema";
import type { FilesApi } from "./files.ts";
import type { Kernel } from "./kernel.ts";

/** Returns a provider's files with core's two members laid over them; every other member passes through. `upload(source)` stores the stream with `objects.putBlob` and returns its `BlobId`. `batch()` returns an empty plan; `put` and `remove` return a new plan with the entry appended, leaving the receiver unchanged. `apply()` writes a `ReceiptRecord { kind: "batch", digest }` in the session (`digest` the plan's content hash) and returns its receipt at once (`Receipt<BatchOutcome>`, also reachable as `session.receipt(id)`); the work then settles it: every `expect` is checked first and any moved path settles `stale { paths }` with nothing written; then each entry is applied in plan order (a `BlobId` put reads the blob), and a write that answers anything but `saved` stops the batch as `partial { applied, remaining, reason }`; all written settles `applied { snapshot, paths }`, `snapshot` from the session's run snapshots `after` keyed by the receipt id, or the empty snapshot id when the environment takes none. `stop()` on the receipt before it settles ends it after the entry in flight as `stopped { applied }`. */
export function wrapFiles(kernel: Kernel, session: SessionId, files: FilesApi): FilesApi {
  throw new Error("not implemented");
}
