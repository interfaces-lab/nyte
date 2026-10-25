import { DEFAULT_CODE_VIEW_LAYOUT } from "@pierre/diffs";
import type { CodeViewLineSelection, CodeViewSearch, SelectedLineRange } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import type {
  CodeViewAnnotationArgs,
  CodeViewHandle,
  CodeViewItem,
  CodeViewReactOptions,
} from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LineStat } from "@nyte-ai/sdk";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Button } from "@nyte-ai/ui/button";
import { ADD_TO_CHAT_LABEL, addToChat, addsToChat } from "../conversation/add-to-chat.ts";
import type { DiffFilesLoader } from "../conversation/diff-expansion.ts";
import {
  DIFF_SEPARATOR_CSS,
  EXPANSION_LINE_COUNT,
  adaptDiffExpanders,
} from "../conversation/diff-view.tsx";
import { diffStyles } from "../conversation/diff.stylex.ts";
import {
  PIERRE_HIGHLIGHTER_OPTIONS,
  PIERRE_TOKEN_CSS,
  PierreWorkerProvider,
} from "../pierre-worker-provider.tsx";
import { workbench } from "../theme/schema.stylex.ts";
import { nyte } from "../nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { keyOwner } from "../shell/focus-owner.ts";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { ReviewCheckbox } from "./changes-sidebar.tsx";
import { FindWidget } from "./find-widget.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { createChangesCodeViewItems, type ChangesStackItem } from "./changes-stack-code-view.ts";
import { diffRangeExcerpt } from "./diff-range.ts";
import type { ChangesLayout } from "./changes-view-options.ts";
import type { ViewedState } from "./changes-viewed.ts";

const styles = create({
  stack: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  findPlacement: { insetBlockStart: `calc(${workbench.headerHeight} + ${space.s2})` },
  preview: {
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    backgroundColor: role.bgBase,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    boxSizing: "border-box",
    width: "100%",
    minHeight: workbench.headerHeight,
    paddingBlock: workbench.headerPaddingBlock,
    paddingInlineEnd: space.s2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
  },
  headerButton: {
    position: "static",
    width: "auto",
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    minHeight: 0,
    paddingRight: 0,
    borderBottomWidth: 0,
    backgroundColor: "transparent",
  },
  path: {
    textOverflow: "ellipsis",
    direction: "rtl",
    textAlign: "left",
  },
  notice: {
    padding: space.s2_5,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    textWrap: "pretty",
  },
});

const STACK_CSS = `${PIERRE_TOKEN_CSS}${DIFF_SEPARATOR_CSS}`;

const SCROLL_SETTLE_MS = 150;

function renderNotice(...[annotation]: CodeViewAnnotationArgs<string>): ReactElement {
  return <div {...props(text.sm, styles.notice)}>{annotation.metadata}</div>;
}

interface ScrollReport {
  top: number;
  timer: number | undefined;
  path: string | undefined;
}

export function ChangesStack({
  items,
  collapsedPaths,
  onToggleCollapsed,
  onExpand,
  scrollTop,
  focusPath,
  focusRevision,
  onFocusApplied,
  layout,
  wordWrap,
  loadDiffFiles,
  viewedState,
  onViewedChange,
  onRevertPath,
  onScrollTop,
  onActivePath,
  onDemandPatch,
}: {
  readonly items: readonly ChangesStackItem[];
  readonly collapsedPaths: readonly string[];
  readonly onToggleCollapsed: (path: string) => void;
  readonly onExpand: (path: string) => void;
  readonly scrollTop: number;
  readonly focusPath: string | undefined;
  readonly focusRevision: number;
  readonly onFocusApplied?: (revision: number) => void;
  readonly layout: ChangesLayout;
  readonly wordWrap: boolean;
  readonly loadDiffFiles?: DiffFilesLoader;
  readonly viewedState: (path: string) => ViewedState;
  readonly onViewedChange: (path: string, viewed: boolean) => void;
  readonly onRevertPath?: (path: string) => void;
  readonly onScrollTop: (scrollTop: number) => void;
  readonly onActivePath: (path: string) => void;
  readonly onDemandPatch?: (path: string) => () => void;
}): ReactElement {
  const theme = useSetting(preferences.theme);
  const viewer = useRef<CodeViewHandle<string, undefined>>(null);
  const restore = useRef<number | undefined>(scrollTop);
  const appliedFocusRevision = useRef(0);
  const [codeItems] = useState(createChangesCodeViewItems);
  const model = codeItems(items, collapsedPaths);
  const collapsed = new Set(collapsedPaths);
  const scrollReport = useRef<ScrollReport>({ top: scrollTop, timer: undefined, path: undefined });
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const sources = useRef(model.sourceById);
  const mac = nyte.platform === "darwin";

  const [find, setFind] = useState<{
    readonly search: CodeViewSearch;
    readonly revision: number;
  }>();

  useLayoutEffect(() => {
    sources.current = model.sourceById;
  }, [model.sourceById]);

  const addRange = (id: string, range: SelectedLineRange): boolean => {
    const item = viewer.current?.getItem(id);
    const source = sources.current.get(id);

    if (item?.type !== "diff" || source === undefined) return false;
    const reference = diffRangeExcerpt(source.path, item.fileDiff, range);

    if (reference === undefined || !addToChat({ reference })) return false;
    viewer.current?.clearSelectedLines();

    return true;
  };

  const addSelectedRange = useEffectEvent(addRange);

  useLayoutEffect(() => {
    if (selection === null) return undefined;

    const add = (event: KeyboardEvent): void => {
      const owner = keyOwner();

      if (event.defaultPrevented || !addsToChat(event, mac)) return;

      if (owner !== undefined && owner.closest("[data-changes-stack]") === null) return;

      if (addSelectedRange(selection.id, selection.range)) event.preventDefault();
    };

    window.addEventListener("keydown", add);

    return () => window.removeEventListener("keydown", add);
  }, [mac, selection]);

  const options = {
    ...PIERRE_HIGHLIGHTER_OPTIONS,
    themeType: theme,
    diffStyle: layout,
    overflow: wordWrap ? "wrap" : "scroll",
    loadDiffFiles,
    expansionLineCount: EXPANSION_LINE_COUNT,
    stickyHeaders: true,
    layout: { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 },
    unsafeCSS: STACK_CSS,
    onPostRender: (node, _instance, phase) => {
      if (phase !== "unmount") adaptDiffExpanders(node);
    },
    enableLineSelection: true,
    onGutterUtilityClick: (
      range: SelectedLineRange,
      context: { readonly item: { readonly id: string } },
    ) => {
      addRange(context.item.id, range);
    },
  } satisfies CodeViewReactOptions<string, undefined>;

  useLayoutEffect(() => {
    const pending = restore.current;

    if (pending === undefined || viewer.current?.getInstance() === undefined) return;
    viewer.current.scrollTo({ type: "position", position: pending, behavior: "instant" });
    restore.current = undefined;
  }, [model.items]);

  useLayoutEffect(() => {
    if (
      focusRevision === 0 ||
      appliedFocusRevision.current === focusRevision ||
      focusPath === undefined ||
      viewer.current?.getItem(focusPath) === undefined
    ) {
      return;
    }

    appliedFocusRevision.current = focusRevision;
    viewer.current.scrollTo({
      type: "item",
      id: focusPath,
      align: "start",
      behavior: "instant",
    });
    onFocusApplied?.(focusRevision);
  }, [focusPath, focusRevision, model.items, onFocusApplied]);

  const renderHeader = (codeItem: CodeViewItem<string>): ReactElement | null => {
    const item = model.sourceById.get(codeItem.id);

    if (item === undefined) return null;
    const viewed = viewedState(item.path);

    return (
      <StackHeader
        path={item.path}
        stat={item.stat}
        collapsed={collapsed.has(item.path)}
        demand={onDemandPatch}
        onToggleCollapsed={onToggleCollapsed}
      >
        {selection?.id === codeItem.id && (
          <Button
            iconOnly
            icon="paperclip"
            aria-label={ADD_TO_CHAT_LABEL}
            aria-keyshortcuts={mac ? "Meta+Shift+L" : "Control+Shift+L"}
            onClick={() => addRange(selection.id, selection.range)}
          />
        )}
        {onRevertPath !== undefined && (
          <Button
            iconOnly
            icon="refresh"
            aria-label={`Revert ${item.path}`}
            onClick={() => onRevertPath(item.path)}
          />
        )}
        <ReviewCheckbox
          state={viewed}
          label={
            viewed === "viewed"
              ? `Mark ${item.path} not viewed`
              : viewed === "changed"
                ? `Mark ${item.path} viewed; changed since last view`
                : viewed === "unknown"
                  ? `Mark ${item.path} viewed; its earlier mark is not checked against this diff yet`
                  : `Mark ${item.path} viewed`
          }
          onChange={(next) => onViewedChange(item.path, next)}
        />
      </StackHeader>
    );
  };

  return (
    <div
      {...props(styles.stack)}
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.altKey ||
          event.shiftKey ||
          (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) ||
          event.key.toLowerCase() !== "f"
        ) {
          return;
        }

        const next = viewer.current?.getInstance()?.search;

        if (next === undefined) return;
        event.preventDefault();
        setFind((current) => ({ search: next, revision: (current?.revision ?? 0) + 1 }));
      }}
    >
      {find !== undefined && (
        <FindWidget
          label="Find in changes"
          target={find.search}
          focusRevision={find.revision}
          placement={styles.findPlacement}
          onClose={() => {
            find.search.clear();
            setFind(undefined);
            viewer.current?.getInstance()?.getContainerElement()?.focus({ preventScroll: true });
          }}
        />
      )}
      <PierreWorkerProvider>
        <CodeView
          ref={viewer}
          items={model.items}
          options={options}
          className={props(styles.preview, diffStyles.patch).className}
          containerRef={(node) => {
            if (node === null) return;
            node.dataset.nyteScrollport = "balanced";
            node.dataset.changesStack = "";
          }}
          onSelectedLinesChange={setSelection}
          onRevealSearchMatch={(codeItem) => {
            const source = model.sourceById.get(codeItem.id);

            if (source !== undefined) onExpand(source.path);
          }}
          renderCustomHeader={renderHeader}
          renderAnnotation={renderNotice}
          onScroll={(top, instance) => {
            const report = scrollReport.current;
            report.top = top;
            window.clearTimeout(report.timer);
            report.timer = window.setTimeout(() => {
              report.timer = undefined;

              if (viewer.current !== null) onScrollTop(report.top);
            }, SCROLL_SETTLE_MS);
            const last = items.at(-1);

            if (last === undefined) return;

            let active = items[0]?.path;

            if (top + instance.getHeight() >= instance.getScrollHeight() - 2) active = last.path;
            else {
              for (const [id, source] of model.sourceById) {
                const itemTop = instance.getTopForItem(id);

                if (itemTop === undefined || itemTop > top + 1) break;
                active = source.path;
              }
            }

            if (active === undefined || active === report.path) return;
            report.path = active;
            onActivePath(active);
          }}
        />
      </PierreWorkerProvider>
    </div>
  );
}

function StackHeader({
  path,
  stat,
  collapsed,
  demand,
  onToggleCollapsed,
  children,
}: {
  readonly path: string;
  readonly stat: LineStat;
  readonly collapsed: boolean;
  readonly demand: ((path: string) => () => void) | undefined;
  readonly onToggleCollapsed: (path: string) => void;
  readonly children: ReactNode;
}): ReactElement {
  const added = stat.kind === "text" ? stat.added : 0;
  const removed = stat.kind === "text" ? stat.removed : 0;

  return (
    <Collapsible.Root
      open={!collapsed}
      onOpenChange={() => onToggleCollapsed(path)}
      data-change-path={path}
      xstyle={styles.headerRow}
    >
      <Collapsible.Trigger
        variant="plain"
        aria-label={collapsed ? `Expand ${path}` : `Collapse ${path}`}
        title={path}
        xstyle={[diffStyles.stackHeader, styles.headerButton]}
      >
        <span {...props(diffStyles.stackHeaderGlyph, diffStyles.stackHeaderIcon)}>
          <FileTypeIcon path={path} />
        </span>
        <Collapsible.Chevron size={12} xstyle={diffStyles.stackHeaderChevron} />
        <span {...props(diffStyles.stackPath, styles.path)}>{path}</span>
        {(added > 0 || removed > 0) && (
          <span
            aria-label={`${String(added)} added, ${String(removed)} removed`}
            {...props(diffStyles.stackStats)}
          >
            {added > 0 && (
              <span {...props(intent.success, diffStyles.added)}>
                +<AnimatedNumber value={added} />
              </span>
            )}
            {removed > 0 && (
              <span {...props(intent.danger, diffStyles.removed)}>
                -<AnimatedNumber value={removed} />
              </span>
            )}
          </span>
        )}
      </Collapsible.Trigger>
      {children}
      {}
      {!collapsed && demand !== undefined && <PatchDemand key={path} path={path} demand={demand} />}
    </Collapsible.Root>
  );
}

function PatchDemand({
  path,
  demand,
}: {
  readonly path: string;
  readonly demand: (path: string) => () => void;
}): null {
  useMountEffect(() => demand(path));

  return null;
}
