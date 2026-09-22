import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata, LineAnnotation } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";
import { patchDigest } from "./changes-viewed.ts";
import type { ChangeStackSection } from "./stacked-diff.ts";

export type ChangesStackItem = ChangeStackSection & {
  readonly added: number;
  readonly removed: number;
};

interface CachedItem {
  readonly payload: string;
  readonly item: CodeViewItem<string>;
}

const NO_DIFFS: readonly FileDiffMetadata[] = [];

function itemId(path: string, index: number): string {
  return index === 0 ? path : `${path}\u0000${String(index)}`;
}

export function createChangesCodeViewItems() {
  const parsedByPatch = new Map<string, readonly FileDiffMetadata[]>();
  const cachedById = new Map<string, CachedItem>();

  const parseDiffs = (patch: string): readonly FileDiffMetadata[] => {
    const cached = parsedByPatch.get(patch);

    if (cached !== undefined) return cached;

    try {
      const parsed = parsePatchFiles(patch, patchDigest(patch)).flatMap((entry) => entry.files);
      const files = parsed.length === 0 ? NO_DIFFS : parsed;
      parsedByPatch.set(patch, files);

      return files;
    } catch {
      parsedByPatch.set(patch, NO_DIFFS);

      return NO_DIFFS;
    }
  };

  const version = (id: string): number => (cachedById.get(id)?.item.version ?? -1) + 1;

  const diffItem = ({
    id,
    payload,
    fileDiff,
    collapsed,
  }: {
    readonly id: string;
    readonly payload: string;
    readonly fileDiff: FileDiffMetadata;
    readonly collapsed: boolean;
  }): CodeViewItem<string> => {
    const cached = cachedById.get(id);

    if (cached?.payload === payload) return cached.item;

    const item: CodeViewItem<string> = {
      id,
      type: "diff",
      fileDiff,
      collapsed,
      version: version(id),
    };

    cachedById.set(id, { payload, item });

    return item;
  };

  const fileItem = ({
    id,
    payload,
    path,
    contents,
    notice,
    collapsed,
  }: {
    readonly id: string;
    readonly payload: string;
    readonly path: string;
    readonly contents: string;
    readonly notice: string | undefined;
    readonly collapsed: boolean;
  }): CodeViewItem<string> => {
    const cached = cachedById.get(id);

    if (cached?.payload === payload) return cached.item;

    const annotation: LineAnnotation<string> | undefined =
      notice === undefined ? undefined : { lineNumber: 0, metadata: notice };

    const item: CodeViewItem<string> = {
      id,
      type: "file",
      file: {
        name: path,
        contents,
        lang: "text",
        cacheKey: `${path}\u0000${patchDigest(contents)}`,
      },
      annotations: annotation === undefined ? undefined : [annotation],
      collapsed,
      version: version(id),
    };

    cachedById.set(id, { payload, item });

    return item;
  };

  return (sources: readonly ChangesStackItem[], collapsedPaths: readonly string[]) => {
    const collapsed = new Set(collapsedPaths);
    const nextItems: CodeViewItem<string>[] = [];
    const sourceById = new Map<string, ChangesStackItem>();

    for (const source of sources) {
      const pathCollapsed = collapsed.has(source.path);

      if (source.kind === "diff") {
        const files = parseDiffs(source.patch);

        if (files.length > 0) {
          files.forEach((fileDiff, index) => {
            const id = itemId(source.path, index);
            const payload = `diff\u0000${source.patch}\u0000${pathCollapsed ? "c" : "e"}`;
            nextItems.push(diffItem({ id, payload, fileDiff, collapsed: pathCollapsed }));
            sourceById.set(id, source);
          });
          continue;
        }
      }

      const id = itemId(source.path, 0);

      const contents =
        source.kind === "diff" ? source.patch : source.kind === "raw" ? source.text : "";

      const notice = source.kind === "notice" ? source.text : undefined;
      const nativeCollapsed = pathCollapsed || source.kind === "pending";
      const payload = `${source.kind}\u0000${contents}\u0000${notice ?? ""}\u0000${nativeCollapsed ? "c" : "e"}`;
      nextItems.push(
        fileItem({
          id,
          payload,
          path: source.path,
          contents,
          notice,
          collapsed: nativeCollapsed,
        }),
      );
      sourceById.set(id, source);
    }

    const patches = new Set(
      sources.flatMap((source) => (source.kind === "diff" ? [source.patch] : [])),
    );

    for (const patch of parsedByPatch.keys()) {
      if (!patches.has(patch)) parsedByPatch.delete(patch);
    }

    for (const id of cachedById.keys()) {
      if (!sourceById.has(id)) cachedById.delete(id);
    }

    return { items: nextItems, sourceById };
  };
}
