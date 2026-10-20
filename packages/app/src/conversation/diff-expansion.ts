import type { FileContents, FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs";
import type { GitApi, GitScope } from "@nyte-ai/sdk";
import { patchDigest } from "../workbench/changes-viewed.ts";

export type DiffContents = Awaited<ReturnType<GitApi["contents"]>>;

type DiffContentsReader = (input: {
  readonly scope: GitScope;
  readonly path: string;
}) => Promise<DiffContents>;

interface DiffExpansionSource {
  readonly readContents: DiffContentsReader;
  readonly root: string;
  readonly scope: GitScope;
}

export type DiffFilesLoader = (fileDiff: FileDiffMetadata) => Promise<FileDiffLoadedFiles>;

function fileSide(
  source: DiffExpansionSource,
  path: string,
  side: "old" | "new",
  contents: string,
): FileContents {
  return {
    name: path,
    contents,
    cacheKey: `${source.root}:${source.scope.kind}:${side}:${path}:${patchDigest(contents)}`,
  };
}

function textSide(
  side: DiffContents["old"],
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

export function createDiffFilesLoader(source: DiffExpansionSource): DiffFilesLoader {
  return async (fileDiff) => {
    const path = fileDiff.name;
    const current = await source.readContents({ scope: source.scope, path });
    const newFile = fileSide(source, path, "new", textSide(current.new, path, "current"));

    if (fileDiff.type === "rename-pure") return { oldFile: null, newFile };

    const previousPath = fileDiff.prevName ?? path;

    const previous =
      previousPath === path
        ? current
        : await source.readContents({ scope: source.scope, path: previousPath });

    const old = textSide(previous.old, previousPath, "previous");

    return { oldFile: fileSide(source, previousPath, "old", old), newFile };
  };
}
