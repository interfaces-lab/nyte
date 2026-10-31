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
import { useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, Ref } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
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
import type { FindWidgetHandle } from "./find-widget.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useCommitCount } from "../work-counts.ts";
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
  revealing: boolean;
}

export interface ChangesStackHandle {
  /** Scrolls to `path`'s file, smoothly when it is near, and keeps it the active file until the scroll settles. */
  readonly reveal: (path: string) => void;
}

interface HeaderInputs {
  readonly sources: ReadonlyMap<string, ChangesStackItem>;
  readonly collapsed: ReadonlySet<string>;
  readonly selected: string | undefined;
  readonly viewedState: (path: string) => ViewedState;
  readonly demand: ((path: string) => () => void) | undefined;
  readonly onToggleCollapsed: (path: string) => void;
  readonly onViewedChange: (path: string, viewed: boolean) => void;
  readonly onRevertPath: ((path: string) => void) | undefined;
  readonly addSelection: () => void;
}

interface HeaderView {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly collapsed: boolean;
  readonly selected: boolean;
  readonly viewed: ViewedState;
  readonly demand: ((path: string) => () => void) | undefined;
  readonly revertable: boolean;
}

function createHeaderStore() {
  let inputs: HeaderInputs | undefined;
  const listeners = new Set<() => void>();

  return {
    get: (): HeaderInputs | undefined => inputs,

    set: (next: HeaderInputs): void => {
      if (next === inputs) return;
      inputs = next;

      for (const listener of listeners) listener();
    },

    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}

type HeaderStore = ReturnType<typeof createHeaderStore>;

export function ChangesStack({
  ref,
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
  readonly ref?: Ref<ChangesStackHandle>;
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
  readonly onScrollTop: (scrollTop: number, activePath: string | undefined) => void;
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

  const scrollReport = useRef<ScrollReport>({
    top: scrollTop,
    timer: undefined,
    path: undefined,
    revealing: false,
  });

  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null);
  const mac = nyte.platform === "darwin";

  const [find, setFind] = useState<CodeViewSearch>();
  const findWidget = useRef<FindWidgetHandle>(null);
  const [headers] = useState(createHeaderStore);

  const addRange = (id: string, range: SelectedLineRange): boolean => {
    const item = viewer.current?.getItem(id);
    const source = headers.get()?.sources.get(id);

    if (item?.type !== "diff" || source === undefined) return false;
    const reference = diffRangeExcerpt(source.path, item.fileDiff, range);

    if (reference === undefined || !addToChat({ reference })) return false;
    viewer.current?.clearSelectedLines();

    return true;
  };

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

  // oxlint-disable-next-line nyte-code/no-direct-effect -- restores the imperative viewer's scroll before paint
  useLayoutEffect(() => {
    const pending = restore.current;

    if (pending === undefined || viewer.current?.getInstance() === undefined) return;
    viewer.current.scrollTo({ type: "position", position: pending, behavior: "instant" });
    restore.current = undefined;
  }, [model.items]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- scrolls the imperative viewer to the focused file before paint
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

  const inputs: HeaderInputs = {
    sources: model.sourceById,
    collapsed,
    selected: selection?.id,
    viewedState,
    demand: onDemandPatch,
    onToggleCollapsed,
    onViewedChange,
    onRevertPath,
    addSelection: () => {
      if (selection !== null) addRange(selection.id, selection.range);
    },
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- hands the latest inputs to the headers Pierre renders, which subscribe to their own slice
  useLayoutEffect(() => headers.set(inputs));

  const renderHeader = (codeItem: CodeViewItem<string>): ReactElement => (
    <StackHeader id={codeItem.id} headers={headers} />
  );

  const settleLater = (): void => {
    const report = scrollReport.current;
    window.clearTimeout(report.timer);
    report.timer = window.setTimeout(() => {
      report.timer = undefined;
      report.revealing = false;

      if (viewer.current !== null) onScrollTop(report.top, report.path);
    }, SCROLL_SETTLE_MS);
  };

  useImperativeHandle(ref, () => ({
    reveal: (path) => {
      if (viewer.current?.getItem(path) === undefined) return;
      const report = scrollReport.current;
      report.revealing = true;
      report.path = path;
      onActivePath(path);
      viewer.current.scrollTo({ type: "item", id: path, align: "start", behavior: "smooth-auto" });
      settleLater();
    },
  }));

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
        findWidget.current?.focus();
        setFind(next);
      }}
    >
      {selection !== null && (
        <WindowKeyDown
          onKeyDown={(event) => {
            const owner = keyOwner();

            if (event.defaultPrevented || !addsToChat(event, mac)) return;

            if (owner !== undefined && owner.closest("[data-changes-stack]") === null) return;

            if (addRange(selection.id, selection.range)) event.preventDefault();
          }}
        />
      )}
      {find !== undefined && (
        <FindWidget
          ref={findWidget}
          label="Find in changes"
          target={find}
          placement={styles.findPlacement}
          onClose={() => {
            find.clear();
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
          onSelectedLinesChange={(next) =>
            setSelection((current) => (sameSelection(current, next) ? current : next))
          }
          onRevealSearchMatch={(codeItem) => {
            const source = model.sourceById.get(codeItem.id);

            if (source !== undefined) onExpand(source.path);
          }}
          renderCustomHeader={renderHeader}
          renderAnnotation={renderNotice}
          onScroll={(top, instance) => {
            const report = scrollReport.current;
            report.top = top;
            settleLater();
            const last = items.at(-1);

            if (report.revealing || last === undefined) return;

            const atTop = instance.getRenderedItems().findLast((rendered) => {
              const itemTop = instance.getTopForItem(rendered.id);

              return itemTop !== undefined && itemTop <= top + 1;
            });

            const active =
              top + instance.getHeight() >= instance.getScrollHeight() - 2
                ? last.path
                : atTop === undefined
                  ? items[0]?.path
                  : model.sourceById.get(atTop.id)?.path;

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
  id,
  headers,
}: {
  readonly id: string;
  readonly headers: HeaderStore;
}): ReactElement | null {
  useCommitCount("render:changes-header");

  const view = useSyncExternalStoreWithSelector(
    headers.subscribe,
    headers.get,
    headers.get,
    (inputs) => headerView(inputs, id),
    sameHeaderView,
  );

  if (view === undefined) return null;
  const path = view.path;
  const added = view.added;
  const removed = view.removed;
  const collapsed = view.collapsed;
  const viewed = view.viewed;
  const demand = view.demand;
  const mac = nyte.platform === "darwin";

  return (
    <Collapsible.Root
      open={!collapsed}
      onOpenChange={() => headers.get()?.onToggleCollapsed(path)}
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
      {view.selected && (
        <Button
          iconOnly
          icon="paperclip"
          aria-label={ADD_TO_CHAT_LABEL}
          aria-keyshortcuts={mac ? "Meta+Shift+L" : "Control+Shift+L"}
          onClick={() => headers.get()?.addSelection()}
        />
      )}
      {view.revertable && (
        <Button
          iconOnly
          icon="refresh"
          aria-label={`Revert ${path}`}
          onClick={() => headers.get()?.onRevertPath?.(path)}
        />
      )}
      <ReviewCheckbox
        state={viewed}
        label={
          viewed === "viewed"
            ? `Mark ${path} not viewed`
            : viewed === "changed"
              ? `Mark ${path} viewed; changed since last view`
              : viewed === "unknown"
                ? `Mark ${path} viewed; its earlier mark is not checked against this diff yet`
                : `Mark ${path} viewed`
        }
        onChange={(next) => headers.get()?.onViewedChange(path, next)}
      />
      {!collapsed && demand !== undefined && <PatchDemand key={path} path={path} demand={demand} />}
    </Collapsible.Root>
  );
}

function headerView(inputs: HeaderInputs | undefined, id: string): HeaderView | undefined {
  const source = inputs?.sources.get(id);

  if (inputs === undefined || source === undefined) return undefined;

  return {
    path: source.path,
    added: source.stat.kind === "text" ? source.stat.added : 0,
    removed: source.stat.kind === "text" ? source.stat.removed : 0,
    collapsed: inputs.collapsed.has(source.path),
    selected: inputs.selected === id,
    viewed: inputs.viewedState(source.path),
    demand: inputs.demand,
    revertable: inputs.onRevertPath !== undefined,
  };
}

function sameHeaderView(left: HeaderView | undefined, right: HeaderView | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;

  return (
    left.path === right.path &&
    left.added === right.added &&
    left.removed === right.removed &&
    left.collapsed === right.collapsed &&
    left.selected === right.selected &&
    left.viewed === right.viewed &&
    left.demand === right.demand &&
    left.revertable === right.revertable
  );
}

function sameSelection(
  left: CodeViewLineSelection | null,
  right: CodeViewLineSelection | null,
): boolean {
  if (left === null || right === null) return left === right;

  return (
    left.id === right.id &&
    left.range.start === right.range.start &&
    left.range.end === right.range.end &&
    left.range.side === right.range.side &&
    left.range.endSide === right.range.endSide
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

function WindowKeyDown({
  onKeyDown,
}: {
  readonly onKeyDown: (event: KeyboardEvent) => void;
}): null {
  const handle = useEffectEvent(onKeyDown);

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => handle(event);

    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  return null;
}
