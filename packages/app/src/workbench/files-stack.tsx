import { CodeView } from "@pierre/diffs/react";
import type { FileContents, LineAnnotation } from "@pierre/diffs";
import type { CodeViewHandle, CodeViewItem, CodeViewReactOptions } from "@pierre/diffs/react";
import { prepareFileTreeInput } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
// oxlint-disable-next-line no-restricted-imports -- the parent hears which file is visible and where the stack was left
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { MentionFile } from "@nyte-ai/client";
import { Button } from "@nyte-ai/ui/button";
import { diffStyles } from "../conversation/styles.stylex.ts";
import { PIERRE_TOKEN_CSS, PierreWorkerProvider } from "../pierre-worker-provider.tsx";
import { useWorkspaceFiles } from "../queries.ts";
import type { WorkspaceFileRead } from "../queries.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "@nyte-ai/ui/vars.stylex";
import { StackHeader } from "./changes-stack.tsx";

const styles = create({
  stack: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  preview: {
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    backgroundColor: t.bgBase,
  },
  notice: {
    padding: 10,
    color: t.contentSecondary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
});

interface StackAnchor {
  readonly path: string;
  readonly offset: number;
}

const NOTICES = {
  binary: "Binary file not shown.",
  too_large: "This file is too large to show.",
  failed: "Couldn't read this file.",
} as const;

interface FileSource {
  readonly key: string;
  readonly file: FileContents;
  readonly annotations: LineAnnotation<string>[] | undefined;
}

/**
 * Each read state gets its own cache key and keeps one `file` object: Pierre
 * treats a new object under a known key as a stale render and throws.
 */
function fileSource(path: string, read: WorkspaceFileRead | undefined): FileSource {
  if (read?.kind === "text") {
    const key = `text\u0000${read.version}`;

    return {
      key,
      file: { name: path, contents: read.contents, cacheKey: `${path}\u0000${key}` },
      annotations: undefined,
    };
  }

  const key = read?.kind ?? "pending";
  const notice = key === "pending" ? undefined : NOTICES[key];

  return {
    key,
    file: { name: path, contents: "", lang: "text", cacheKey: `${path}\u0000${key}` },
    annotations: notice === undefined ? undefined : [{ lineNumber: 0, metadata: notice }],
  };
}

function createFileCodeViewItems() {
  const cache = new Map<
    string,
    {
      readonly source: FileSource;
      readonly collapsed: boolean;
      readonly item: CodeViewItem<string>;
    }
  >();

  return (
    paths: readonly string[],
    reads: ReadonlyMap<string, WorkspaceFileRead>,
    collapsedPaths: ReadonlySet<string>,
  ): readonly CodeViewItem<string>[] => {
    const items = paths.map((path) => {
      const next = fileSource(path, reads.get(path));
      const collapsed = collapsedPaths.has(path);
      const cached = cache.get(path);
      const source = cached?.source.key === next.key ? cached.source : next;

      if (cached !== undefined && cached.source === source && cached.collapsed === collapsed) {
        return cached.item;
      }

      const item: CodeViewItem<string> = {
        id: path,
        type: "file",
        file: source.file,
        annotations: source.annotations,
        // An unread file shows its header only; reading starts once the header is on screen.
        collapsed: collapsed || source.key === "pending",
        version: (cached?.item.version ?? -1) + 1,
      };

      cache.set(path, { source, collapsed, item });

      return item;
    });

    const live = new Set(paths);

    for (const path of cache.keys()) {
      if (!live.has(path)) cache.delete(path);
    }

    return items;
  };
}

/**
 * Every workspace file stacked in explorer order, read as its header scrolls
 * into view. The reads and scroll position outlive the view, so returning to
 * the tab lands where the reader left.
 */
export function FilesStack({
  files,
  active,
  lineNumbers,
  wordWrap,
  onActivePath,
  onOpen,
}: {
  readonly files: readonly MentionFile[] | undefined;
  readonly active: boolean;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  readonly onActivePath: (path: string) => void;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement | null {
  const [requested, setRequested] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [anchor, setAnchor] = useState<StackAnchor>();
  const [codeItems] = useState(createFileCodeViewItems);

  const ordered = useMemo(() => {
    const byPath = new Map((files ?? []).map((file) => [file.displayPath, file]));

    return prepareFileTreeInput([...byPath.keys()], {
      flattenEmptyDirectories: true,
    }).paths.flatMap((path) => {
      const file = byPath.get(path);

      return file === undefined || path.endsWith("/") ? [] : [file];
    });
  }, [files]);

  const wanted = useMemo(
    () => ordered.filter((file) => requested.has(file.displayPath)),
    [ordered, requested],
  );

  const reads = useWorkspaceFiles(
    wanted.map((file) => file.path),
    active,
  );

  const items = useMemo(() => {
    const readByPath = new Map(
      wanted.flatMap((file, index) => {
        const read = reads[index];

        return read === undefined ? [] : [[file.displayPath, read] as const];
      }),
    );

    return codeItems(
      ordered.map((file) => file.displayPath),
      readByPath,
      collapsed,
    );
  }, [codeItems, ordered, wanted, reads, collapsed]);

  const request = useCallback((path: string): void => {
    setRequested((current) => (current.has(path) ? current : new Set(current).add(path)));
  }, []);

  const toggleCollapsed = useCallback((path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);

      if (!next.delete(path)) next.add(path);

      return next;
    });
  }, []);

  const open = useCallback(
    (path: string): void => {
      const file = ordered.find((candidate) => candidate.displayPath === path);

      if (file !== undefined) onOpen(file);
    },
    [ordered, onOpen],
  );

  if (!active || ordered.length === 0) return null;

  return (
    <div {...props(styles.stack)}>
      <FilesCodeView
        items={items}
        collapsed={collapsed}
        anchor={anchor}
        lineNumbers={lineNumbers}
        wordWrap={wordWrap}
        onVisible={request}
        onToggleCollapsed={toggleCollapsed}
        onOpen={open}
        onLeave={setAnchor}
        onActivePath={onActivePath}
      />
    </div>
  );
}

function FilesCodeView({
  items,
  collapsed,
  anchor,
  lineNumbers,
  wordWrap,
  onVisible,
  onToggleCollapsed,
  onOpen,
  onLeave,
  onActivePath,
}: {
  readonly items: readonly CodeViewItem<string>[];
  readonly collapsed: ReadonlySet<string>;
  readonly anchor: StackAnchor | undefined;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  readonly onVisible: (path: string) => void;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onOpen: (path: string) => void;
  readonly onLeave: (anchor: StackAnchor | undefined) => void;
  readonly onActivePath: (path: string) => void;
}): ReactElement {
  const appearance = useAppearanceSettings();
  const viewer = useRef<CodeViewHandle<string, undefined>>(null);
  const restore = useRef(anchor);
  const lastAnchor = useRef(anchor);

  const options = useMemo(
    () =>
      ({
        themeType: appearance.theme,
        overflow: wordWrap ? "wrap" : "scroll",
        disableLineNumbers: !lineNumbers,
        stickyHeaders: true,
        unsafeCSS: PIERRE_TOKEN_CSS,
      }) satisfies CodeViewReactOptions<string, undefined>,
    [appearance.theme, lineNumbers, wordWrap],
  );

  useEffect(() => () => onLeave(lastAnchor.current), [onLeave]);

  // A pixel offset drifts once the files above are measured again; the top file does not.
  useLayoutEffect(() => {
    const target = restore.current;

    if (target === undefined || viewer.current?.getItem(target.path) === undefined) return;
    viewer.current.scrollTo({
      type: "item",
      id: target.path,
      align: "start",
      offset: target.offset,
      behavior: "instant",
    });
    restore.current = undefined;
  }, [items]);

  const renderHeader = useCallback(
    (item: CodeViewItem<string>): ReactElement => (
      <FileHeader
        path={item.id}
        collapsed={collapsed.has(item.id)}
        onVisible={onVisible}
        onToggleCollapsed={onToggleCollapsed}
        onOpen={onOpen}
      />
    ),
    [collapsed, onVisible, onToggleCollapsed, onOpen],
  );

  return (
    <PierreWorkerProvider>
      <CodeView
        ref={viewer}
        items={items}
        options={options}
        className={props(styles.preview, diffStyles.patch).className}
        containerRef={(node) => {
          if (node === null) return;
          node.dataset.nyteScrollport = "balanced";
        }}
        renderCustomHeader={renderHeader}
        renderAnnotation={(annotation) => (
          <div {...props(styles.notice)}>{annotation.metadata}</div>
        )}
        onScroll={(top, instance) => {
          let active = 0;

          if (top + instance.getHeight() >= instance.getScrollHeight() - 2) {
            active = items.length - 1;
          } else {
            // Items are laid out in order, so the last one starting above the fold is on top.
            let low = 0;
            let high = items.length - 1;

            while (low <= high) {
              const middle = Math.floor((low + high) / 2);
              const id = items[middle]?.id;
              const itemTop = id === undefined ? undefined : instance.getTopForItem(id);

              if (itemTop !== undefined && itemTop <= top + 1) {
                active = middle;
                low = middle + 1;
              } else {
                high = middle - 1;
              }
            }
          }

          const path = items[active]?.id;
          const itemTop = path === undefined ? undefined : instance.getTopForItem(path);

          if (path === undefined || itemTop === undefined) return;
          const previous = lastAnchor.current?.path;
          lastAnchor.current = { path, offset: itemTop - top };

          if (path !== previous) onActivePath(path);
        }}
      />
    </PierreWorkerProvider>
  );
}

function FileHeader({
  path,
  collapsed,
  onVisible,
  onToggleCollapsed,
  onOpen,
}: {
  readonly path: string;
  readonly collapsed: boolean;
  readonly onVisible: (path: string) => void;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onOpen: (path: string) => void;
}): ReactElement {
  useEffect(() => onVisible(path), [onVisible, path]);

  return (
    <StackHeader path={path} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed}>
      <Button iconOnly icon="pencil" aria-label={`Edit ${path}`} onClick={() => onOpen(path)} />
    </StackHeader>
  );
}
