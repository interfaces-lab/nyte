import { isAbsolute } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import type { DocumentsApi } from "@nyte-ai/core";
import { readBytes, readDocument, watchFiles, writeDocument } from "./files.ts";

/** Returns this machine's files by absolute path, read, streamed, written and watched as `localFiles` does inside a folder, with no `scope` on a read. A relative path throws `SdkError("invalid")`. `signal` ends every open `watch`. */
export function localDocuments(signal: AbortSignal): DocumentsApi {
  return {
    read: async (path, options) => readDocument(absolute(path), path, options?.as),
    bytes: async (path) => readBytes(absolute(path), path),
    write: async (path, contents, options) =>
      writeDocument(absolute(path), path, contents, options),
    watch: (paths) => watchFiles(null, paths.map(absolute), signal),
  };
}

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new SdkError("invalid", `${path} is not an absolute path.`);

  return path;
}
