import type { FileDiffMetadata } from "@pierre/diffs";
import type { PatchEntry } from "./changes-patches.ts";

const FAILED_PATCH = "The patch could not be read.";

export const EMPTY_PATCH = "No text diff is available for this file.";

function tooLargeText(limit: number): string {
  return `This diff is larger than ${String(Math.round(limit / 1_000_000))} MB, so it isn’t shown.`;
}

/**
 * One file in the stack. `pending` has no patch yet: the stack shows its
 * header alone until the patch is read, first if its header is rendered and
 * otherwise in the background.
 */
export type ChangeStackSection =
  | {
      readonly kind: "diff";
      readonly path: string;
      readonly patch: string;
      readonly digest: string;
      readonly files: readonly FileDiffMetadata[];
    }
  | { readonly kind: "raw"; readonly path: string; readonly text: string }
  | { readonly kind: "notice"; readonly path: string; readonly text: string }
  | { readonly kind: "pending"; readonly path: string };

export function patchStackSection({
  path,
  entry,
}: {
  readonly path: string;
  readonly entry: PatchEntry | undefined;
}): ChangeStackSection {
  if (entry === undefined) return { kind: "pending", path };

  switch (entry.kind) {
    case "ready":
      return { kind: "diff", path, patch: entry.patch, digest: entry.digest, files: entry.files };
    case "binary":
      return { kind: "raw", path, text: entry.text };
    case "empty":
      return { kind: "notice", path, text: EMPTY_PATCH };
    case "too_large":
      return { kind: "notice", path, text: tooLargeText(entry.limit) };
    case "failed":
      return { kind: "notice", path, text: FAILED_PATCH };
    default: {
      const _exhaustive: never = entry;

      return _exhaustive;
    }
  }
}
