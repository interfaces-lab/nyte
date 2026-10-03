import { DEFAULT_CODE_VIEW_LAYOUT } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewItem, CodeViewReactOptions } from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Button } from "@nyte-ai/ui/button";
import type { DiffFilesLoader } from "../conversation/diff-expansion.ts";
import {
  DIFF_SEPARATOR_CSS,
  EXPANSION_LINE_COUNT,
  adaptDiffExpanders,
} from "../conversation/diff-view.tsx";
import { diffStyles } from "../conversation/styles.stylex.ts";
import { PIERRE_TOKEN_CSS, PierreWorkerProvider } from "../pierre-worker-provider.tsx";
import { workbench } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { ReviewCheckbox } from "./changes-sidebar.tsx";
import { createChangesCodeViewItems, type ChangesStackItem } from "./changes-stack-code-view.ts";
import type { ChangesLayout } from "./changes-view-options.ts";
import type { ViewedState } from "./changes-viewed.ts";

const styles = create({
  preview: {
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    backgroundColor: role.bgBase,
  },
  // The file tree's filter row sits beside the first header, so both take the workbench header height.
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box",
    width: "100%",
    minHeight: workbench.headerHeight,
    paddingBlock: workbench.headerPaddingBlock,
    paddingInlineEnd: 8,
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
    padding: 10,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
});

const STACK_CSS = `${PIERRE_TOKEN_CSS}${DIFF_SEPARATOR_CSS}`;

/**
 * The scroll position is workbench state, and every write to it re-renders the
 * workbench and persists the snapshot. Scrolling reports once it settles;
 * the active file reports only when it changes.
 */
const SCROLL_SETTLE_MS = 150;

interface ScrollReport {
  top: number;
  timer: number | undefined;
  path: string | undefined;
}

export function ChangesStack({
  items,
  collapsedPaths,
  onToggleCollapsed,
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
}: {
  readonly items: readonly ChangesStackItem[];
  readonly collapsedPaths: readonly string[];
  readonly onToggleCollapsed: (path: string) => void;
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
}): ReactElement {
  const appearance = useAppearanceSettings();
  const viewer = useRef<CodeViewHandle<string, undefined>>(null);
  const restore = useRef<number | undefined>(scrollTop);
  const appliedFocusRevision = useRef(0);
  const [codeItems] = useState(createChangesCodeViewItems);
  const model = useMemo(() => codeItems(items, collapsedPaths), [codeItems, items, collapsedPaths]);
  const collapsed = useMemo(() => new Set(collapsedPaths), [collapsedPaths]);
  const scrollReport = useRef<ScrollReport>({ top: scrollTop, timer: undefined, path: undefined });

  const options = useMemo(
    () =>
      ({
        themeType: appearance.theme,
        diffStyle: layout,
        overflow: wordWrap ? "wrap" : "scroll",
        loadDiffFiles,
        expansionLineCount: EXPANSION_LINE_COUNT,
        stickyHeaders: true,
        // The first header starts flush with the file tree's filter row.
        layout: { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 },
        unsafeCSS: STACK_CSS,
        onPostRender: (node, _instance, phase) => {
          if (phase !== "unmount") adaptDiffExpanders(node);
        },
      }) satisfies CodeViewReactOptions<string, undefined>,
    [appearance.theme, layout, loadDiffFiles, wordWrap],
  );

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

  const renderHeader = useCallback(
    (codeItem: CodeViewItem<string>): ReactElement | null => {
      const item = model.sourceById.get(codeItem.id);

      if (item === undefined) return null;
      const viewed = viewedState(item.path);

      return (
        <StackHeader
          path={item.path}
          added={item.added}
          removed={item.removed}
          collapsed={collapsed.has(item.path)}
          onToggleCollapsed={onToggleCollapsed}
        >
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
                  : `Mark ${item.path} viewed`
            }
            onChange={(next) => onViewedChange(item.path, next)}
          />
        </StackHeader>
      );
    },
    [collapsed, model.sourceById, onRevertPath, onToggleCollapsed, onViewedChange, viewedState],
  );

  return (
    <PierreWorkerProvider>
      <CodeView
        ref={viewer}
        items={model.items}
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
          const report = scrollReport.current;
          report.top = top;
          // React clears the viewer ref on unmount; a timer that outlives the stack writes nothing.
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
  );
}

function StackHeader({
  path,
  added = 0,
  removed = 0,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  readonly path: string;
  readonly added?: number;
  readonly removed?: number;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: (path: string) => void;
  readonly children: ReactNode;
}): ReactElement {
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
        <Collapsible.Chevron
          size={12}
          xstyle={[diffStyles.stackHeaderGlyph, diffStyles.stackHeaderChevron]}
        />
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
    </Collapsible.Root>
  );
}
