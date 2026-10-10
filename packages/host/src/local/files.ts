import type { FilesApi } from "@nyte-ai/core";
import type { ByteReader, FileVersion } from "@nyte-ai/schema";

/** Returns a byte reader that carries the version of the file it read, which the server answers as `X-Nyte-Version` (§40h, §40p). */
export type VersionedReader = ByteReader & { readonly version: FileVersion };

/** Returns the local `FilesApi`, its `bytes` typed with the version it read. */
export type LocalFiles = Omit<FilesApi, "bytes"> & {
  bytes(path: string): Promise<VersionedReader>;
};

/** Returns a folder's files over `node:fs`: a relative path resolves against `root`, an absolute one is taken as given (the ancestor context files are read through it, §37g). A version is the SHA-256 of what is there, never an mtime: a file's contents, a directory's sorted entry names, a symlink's target. `read` answers `text` for UTF-8 without NUL up to 2,000,000 bytes, `large` above, `binary` otherwise, `missing` when absent; `bytes` streams the file with its size, a null mime and its version; `stat` uses `lstat` (a symlink with its `target`), null when absent. `write` compares `expect` with the current version first (`stale { current }`, `absent` needing no file), answers `missing-parent` unless `parents`, and writes through a temporary file renamed into place; `remove` compares `expect` the same way. `batch()` and `upload()` throw `SdkError("unavailable")`: core lays its own over them (`wrapFiles`). `format` runs `formatter`, else the first of `oxfmt`, `prettier` and `biome` under `<root>/node_modules/.bin`, with the contents on stdin and the path for its config, answering `unchanged` when equal and `unavailable { reason }` when there is none or it fails. `scan` walks `directory` (default the root) breadth-first in pages of entries, skipping `.git` and, unless `ignored: "include"`, what `.gitignore` files and `.git/info/exclude` ignore (`ignore`), then `complete`, or `incomplete` with `limit` after 100,000 entries or `permission` at an unreadable directory. `find` matches the query fuzzily against scanned paths, ranked by match quality then length, at most `limit` (default 20, capped at 100). `search` runs `ripgrep` (else `rg` on the PATH; with neither, a scan of the text files) for the literal query with smart case, yielding `match` frames, then `complete`, or `truncated` at `limit` (default 200). `watch` uses a recursive `fs.watch` on the root, narrowed to `paths` when given and without ignored paths, coalescing changes over 50 ms into created, modified and removed events with the version after (null when removed). */
export function localFiles(
  root: string,
  options?: { readonly ripgrep?: string; readonly formatter?: string },
): LocalFiles {
  throw new Error("not implemented");
}
