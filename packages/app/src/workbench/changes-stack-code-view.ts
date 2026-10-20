import type { FileDiffMetadata, LineAnnotation } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";
import type { LineStat } from "@nyte-ai/sdk";
import { patchDigest } from "./changes-viewed.ts";
import type { ChangeStackSection } from "./stacked-diff.ts";

export type ChangesStackItem = ChangeStackSection & { readonly stat: LineStat };

interface CachedItem {
  readonly payload: string;
  readonly item: CodeViewItem<string>;
}

function itemId(path: string, index: number): string {
  return index === 0 ? path : `${path}\u0000${String(index)}`;
}

function placeholderDiff(path: string): FileDiffMetadata {
  return {
    name: path,
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: false,
    deletionLines: [],
    additionLines: [],
  };
}

export function createChangesCodeViewItems() {
  const cachedById = new Map<string, CachedItem>();

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

    const cacheKey = `${path}\u0000${patchDigest(contents)}`;

    const item: CodeViewItem<string> = {
      id,
      type: "file",
      file:
        cached?.item.type === "file" && cached.item.file.cacheKey === cacheKey
          ? cached.item.file
          : { name: path, contents, lang: "text", cacheKey },
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

      if (source.kind === "diff" && source.files.length > 0) {
        source.files.forEach((fileDiff, index) => {
          const id = itemId(source.path, index);
          const payload = `diff\u0000${source.digest}\u0000${pathCollapsed ? "c" : "e"}`;
          nextItems.push(diffItem({ id, payload, fileDiff, collapsed: pathCollapsed }));
          sourceById.set(id, source);
        });
        continue;
      }

      const id = itemId(source.path, 0);

      if (source.kind === "pending") {
        nextItems.push(
          diffItem({
            id,
            payload: "pending",
            fileDiff: placeholderDiff(source.path),
            collapsed: true,
          }),
        );
        sourceById.set(id, source);
        continue;
      }

      const contents =
        source.kind === "diff" ? source.patch : source.kind === "raw" ? source.text : "";

      const notice = source.kind === "notice" ? source.text : undefined;
      const nativeCollapsed = pathCollapsed;

      const payload =
        source.kind === "diff"
          ? `unparsed\u0000${source.digest}\u0000${nativeCollapsed ? "c" : "e"}`
          : `${source.kind}\u0000${contents}\u0000${notice ?? ""}\u0000${nativeCollapsed ? "c" : "e"}`;

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

    for (const id of cachedById.keys()) {
      if (!sourceById.has(id)) cachedById.delete(id);
    }

    return { items: nextItems, sourceById };
  };
}
