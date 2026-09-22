/**
 * Full file contents for Pierre's collapsed-context expansion.
 *
 * A patch carries only the lines inside its hunks, so Pierre can only widen a
 * collapsed gap once it holds both whole sides of the file. It asks for them
 * through `loadDiffFiles`, and rejects are reported and dropped, so a file
 * this reader cannot serve simply stays collapsed.
 *
 * The contents reader is injected rather than imported: the bridge only exists
 * inside Electron, and this module is exercised without it.
 */
import type { FileContents, FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs";
import type { VcsContents, VcsScope } from "@nyte-ai/protocol";

/** `nyte.workspace.vcs.contents`, passed in so this module stays testable. */
export type DiffContentsReader = (input: {
  readonly scope: VcsScope;
  readonly path: string;
}) => Promise<VcsContents>;

export interface DiffExpansionSource {
  readonly readContents: DiffContentsReader;
  /** The repository root, so two checkouts of one path cannot share a cache entry. */
  readonly root: string;
  /** Revision the working copy is compared against; contents change with it. */
  readonly revision: string;
  readonly scope: VcsScope;
}

export type DiffFilesLoader = (fileDiff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;

/**
 * Pierre reuses highlight results per key, so the key has to name everything
 * that can change the text: which checkout, which revision, which comparison
 * base, which path, and which side of the diff.
 */
function fileSide(
  source: DiffExpansionSource,
  path: string,
  side: "old" | "new",
  contents: string,
): FileContents {
  return {
    name: path,
    contents,
    cacheKey: `${source.root}@${source.revision}:${source.scope.kind}:${side}:${path}`,
  };
}

function textSide(
  side: VcsContents["old"],
  path: string,
  position: "current" | "previous",
): string {
  switch (side.kind) {
    case "text":
      return side.text;
    case "absent":
      throw new Error(`Cannot expand ${path}: it has no ${position} contents`);
    case "binary":
      throw new Error(`Cannot expand ${path}: the file is binary`);
    case "truncated":
      throw new Error(`Cannot expand ${path}: the file was read only in part`);
    default: {
      const _exhaustive: never = side;

      return _exhaustive;
    }
  }
}

/**
 * Builds the loader Pierre calls when a reader asks for more context.
 *
 * Pierre only calls it for changed and renamed files parsed from a patch;
 * added, deleted and untracked files already hold every line they have.
 */
export function createDiffFilesLoader(source: DiffExpansionSource): DiffFilesLoader {
  return async (fileDiff) => {
    const path = fileDiff.name;
    const current = await source.readContents({ scope: source.scope, path });
    const newFile = fileSide(source, path, "new", textSide(current.new, path, "current"));

    // A pure rename has no content change, and Pierre wants the old side left
    // out rather than duplicated.
    if (fileDiff.type === "rename-pure") return { oldFile: null, newFile };

    // A rename's previous contents live under the previous path; the new path
    // has no old side there.
    const previousPath = fileDiff.prevName ?? path;

    const previous =
      previousPath === path
        ? current
        : await source.readContents({ scope: source.scope, path: previousPath });

    const old = textSide(previous.old, previousPath, "previous");

    return { oldFile: fileSide(source, previousPath, "old", old), newFile };
  };
}
