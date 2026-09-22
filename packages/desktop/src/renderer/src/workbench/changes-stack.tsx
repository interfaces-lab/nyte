import { CodeView } from "@pierre/diffs/react";
import type { CodeViewHandle, CodeViewItem, CodeViewReactOptions } from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon";
import { Icon } from "../components/icons.tsx";
import { IconButton } from "../components/ui";
import type { DiffFilesLoader } from "../conversation/diff-expansion.ts";
import { diffStyles } from "../conversation/styles.stylex.ts";
import { PierreWorkerProvider } from "../pierre-worker-provider.tsx";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
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
    backgroundColor: t.bgEditor,
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: "100%",
    paddingInlineEnd: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
    backgroundColor: t.bgBase,
  },
  headerButton: {
    position: "static",
    width: "auto",
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
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
    color: t.textTertiary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
});

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

  const options = useMemo(
    () =>
      ({
        themeType: appearance.theme,
        diffStyle: layout,
        overflow: wordWrap ? "wrap" : "scroll",
        loadDiffFiles,
        stickyHeaders: true,
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

      return (
        <StackHeader
          item={item}
          collapsed={collapsed.has(item.path)}
          viewed={viewedState(item.path)}
          onViewedChange={onViewedChange}
          onRevertPath={onRevertPath}
          onToggleCollapsed={onToggleCollapsed}
        />
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
          onScrollTop(top);
          const last = items.at(-1);

          if (last === undefined) return;

          if (top + instance.getHeight() >= instance.getScrollHeight() - 2) {
            onActivePath(last.path);

            return;
          }

          let active = items[0]?.path;

          for (const [id, source] of model.sourceById) {
            const itemTop = instance.getTopForItem(id);

            if (itemTop === undefined || itemTop > top + 1) break;
            active = source.path;
          }

          if (active !== undefined) onActivePath(active);
        }}
      />
    </PierreWorkerProvider>
  );
}

function StackHeader({
  item,
  collapsed,
  viewed,
  onViewedChange,
  onRevertPath,
  onToggleCollapsed,
}: {
  readonly item: ChangesStackItem;
  readonly collapsed: boolean;
  readonly viewed: ViewedState;
  readonly onViewedChange: (path: string, viewed: boolean) => void;
  readonly onRevertPath?: (path: string) => void;
  readonly onToggleCollapsed: (path: string) => void;
}): ReactElement {
  return (
    <div data-change-path={item.path} {...props(styles.headerRow)}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${item.path}` : `Collapse ${item.path}`}
        title={item.path}
        {...props(diffStyles.stackHeader, styles.headerButton)}
        onClick={() => onToggleCollapsed(item.path)}
      >
        <span {...props(diffStyles.stackHeaderGlyph, diffStyles.stackHeaderIcon)}>
          <FileTypeIcon path={item.path} />
        </span>
        <span {...props(diffStyles.stackHeaderGlyph, diffStyles.stackHeaderChevron)}>
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </span>
        <span {...props(diffStyles.stackPath, styles.path)}>{item.path}</span>
        {(item.added > 0 || item.removed > 0) && (
          <span
            aria-label={`${String(item.added)} added, ${String(item.removed)} removed`}
            {...props(diffStyles.stackStats)}
          >
            {item.added > 0 && (
              <span {...props(diffStyles.added)}>
                +<AnimatedNumber value={item.added} />
              </span>
            )}
            {item.removed > 0 && (
              <span {...props(diffStyles.removed)}>
                -<AnimatedNumber value={item.removed} />
              </span>
            )}
          </span>
        )}
      </button>
      <IconButton
        icon="refresh"
        label={`Revert ${item.path}`}
        disabled={onRevertPath === undefined}
        onClick={() => onRevertPath?.(item.path)}
      />
      <ReviewCheckbox
        state={viewed}
        label={
          viewed === "viewed"
            ? `Mark ${item.path} not viewed`
            : viewed === "changed"
              ? `${item.path} changed since you viewed it`
              : `Mark ${item.path} viewed`
        }
        onChange={(next) => onViewedChange(item.path, next)}
      />
    </div>
  );
}
