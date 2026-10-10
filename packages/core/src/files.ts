import type {
  BatchOutcome,
  BlobId,
  ByteReader,
  FileDocument,
  FileEntryView,
  FileEvent,
  FileVersion,
  FormatOutcome,
  ScanFrame,
  SearchFrame,
  WriteOutcome,
} from "@nyte-ai/schema";
import type { Receipt } from "./receipt.ts";

/**
 * Reads, writes, scans, searches and watches files in a workspace.
 *
 * **Details**
 *
 * A version is a content fingerprint the driver can check, not an mtime.
 * External editors are external: a write with `expect` answers stale rather
 * than overwriting; a write without `expect` overwrites and says so.
 *
 * @category files
 * @since 0.1.0
 */
export interface FilesApi {
  /**
   * Returns a file as text, binary, large or missing, each with its version.
   *
   * @authority participant
   */
  read(path: string): Promise<FileDocument>;
  /**
   * Returns an owned byte stream for binary and large files, carrying the
   * version it read.
   *
   * @stream frames
   * @authority participant
   */
  bytes(path: string): Promise<ByteReader>;
  /**
   * Returns kind, size and version, or null when nothing is there.
   *
   * @authority participant
   */
  stat(path: string): Promise<{ readonly kind: "file" | "directory" | "symlink"; readonly size: number; readonly version: FileVersion; readonly target?: string } | null>;
  /**
   * Writes a file; `missing-parent` unless `parents`.
   *
   * @returns {@link WriteOutcome}
   * @authority participant
   */
  write(path: string, contents: string | Uint8Array, options?: { readonly expect?: FileVersion | "absent"; readonly parents?: boolean }): Promise<WriteOutcome>;
  /**
   * Removes a file.
   *
   * @returns {@link WriteOutcome}
   * @authority participant
   */
  remove(path: string, options?: { readonly expect?: FileVersion }): Promise<WriteOutcome>;
  /**
   * Returns an empty immutable plan; only `apply()` writes.
   *
   * **Details**
   *
   * One reviewed intent, not cross-file ACID.
   *
   * @handle
   */
  batch(): FileBatch;
  /**
   * Formats contents with the workspace's formatter. Never writes.
   *
   * **Outcomes**
   *
   * - `formatted`: `contents` is the formatted text.
   * - `unchanged`: already formatted.
   * - `unavailable`: no formatter for this path.
   *
   * @authority participant
   */
  format(path: string, contents: string): Promise<FormatOutcome>;
  /**
   * Yields pages of entries, then `complete` or `incomplete { reason }`.
   *
   * @stream frames
   * @authority participant
   */
  scan(input?: { readonly directory?: string; readonly ignored?: "exclude" | "include" }): AsyncIterable<ScanFrame>;
  /**
   * Returns name matches, host-narrowed and host-capped: the @ mention list.
   *
   * **Details**
   *
   * A phone asks for ten rows, never the tree.
   *
   * @authority participant
   */
  find(input: { readonly query: string; readonly limit?: number }): Promise<readonly FileEntryView[]>;
  /**
   * Yields content matches, then `complete` or `truncated`.
   *
   * @stream frames
   * @authority participant
   */
  search(input: { readonly query: string; readonly limit?: number }): AsyncIterable<SearchFrame>;
  /**
   * Yields created, modified and removed events with versions, coalesced.
   *
   * @stream watch
   * @authority participant
   */
  watch(input?: { readonly paths?: readonly string[] }): AsyncIterable<readonly FileEvent[]>;
  /**
   * Stores a byte stream as a blob for `UserContent` files; replayable.
   *
   * @authority participant
   */
  upload(source: AsyncIterable<Uint8Array>): Promise<BlobId>;
}

/**
 * Returns an immutable plan of file writes and removals applied as one
 * durable command.
 *
 * **Example** (Applying a reviewed edit)
 *
 * ```ts
 * declare const files: FilesApi;
 * declare const version: FileVersion;
 *
 * const receipt = await files
 *   .batch()
 *   .put({ path: "src/parser.ts", contents: "export {};\n", expect: version })
 *   .put({ path: "src/parser.test.ts", contents: "", expect: "absent" })
 *   .remove({ path: "src/legacy-parser.ts" })
 *   .apply();
 * const outcome = await receipt.settled();
 * if (outcome.kind === "stale") console.log(outcome.paths);
 * ```
 *
 * @category files
 * @since 0.1.0
 */
export interface FileBatch {
  /** Returns a new plan with one more write. */
  put(input: { readonly path: string; readonly contents: string | Uint8Array | BlobId; readonly expect?: FileVersion | "absent" }): FileBatch;
  /** Returns a new plan with one more removal. */
  remove(input: { readonly path: string; readonly expect?: FileVersion }): FileBatch;
  /**
   * Applies the plan as a durable command.
   *
   * @returns {@link BatchOutcome}, through the receipt.
   * @authority participant
   */
  apply(): Promise<Receipt<BatchOutcome>>;
}
