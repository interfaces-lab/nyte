import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AnimatedNumber } from "../components/animated-number.tsx";
import { FileTypeIcon } from "../components/file-type-icon";
import { Icon } from "../components/icons.tsx";
import { DiffView } from "../conversation/diff-view";
import { diffStyles } from "../conversation/styles.stylex.ts";
import type { ParsedDiff } from "../conversation/tool-detail.ts";
import { localFontFamily, type AppearanceSettings } from "../theme/boot.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { t } from "../theme/vars.stylex.ts";
import {
  canvasFont,
  pretextFitsWidth,
  pretextLineHeight,
  pretextNaturalWidth,
  truncateStartText,
} from "./pretext.ts";
import {
  STACKED_DIFF_LINE_HEIGHT,
  STACKED_HEADER_HEIGHT,
  STACKED_LIST_PADDING_END,
  activeChangePath,
  diffMarksWidth,
  stackedGutterWidth,
  stackedOffsets,
  stackedScrollHeight,
  stackedSectionHeight,
  visibleStackedRange,
  type ChangeStackSection,
  type StackedOffset,
} from "./stacked-diff.ts";
import { useClientBox } from "./use-client-box.ts";

type ChangesStackItem =
  | (Extract<ChangeStackSection, { kind: "diff" }> & {
      readonly parsed: ParsedDiff;
      readonly added: number;
      readonly removed: number;
    })
  | (Exclude<ChangeStackSection, { kind: "diff" }> & {
      readonly added: number;
      readonly removed: number;
    });

export function changesStackItem(
  section: ChangeStackSection,
  stats: { readonly added: number; readonly removed: number },
  parsed: ParsedDiff | undefined,
): ChangesStackItem {
  if (section.kind !== "diff") return { ...section, ...stats };
  if (parsed !== undefined) return { ...section, parsed, ...stats };
  return { kind: "raw", path: section.path, text: section.patch, ...stats };
}

const styles = stylex.create({
  preview: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" },
  frame: { minWidth: 0 },
  notice: {
    padding: 10,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  raw: {
    margin: 0,
    padding: 10,
    color: t.textSecondary,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

function quotedFamily(family: string): string {
  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function pretextUiFace(settings: AppearanceSettings): string {
  const local = localFontFamily(settings.uiFont);
  if (local !== undefined) return quotedFamily(local);
  return settings.uiFont === "inter" ? '"Inter Variable"' : "Helvetica";
}

function pretextCodeFace(settings: AppearanceSettings): string {
  const local = localFontFamily(settings.codeFont);
  if (local !== undefined) return quotedFamily(local);
  return settings.codeFont === "jetbrains-mono" ? '"JetBrains Mono Variable"' : "Menlo";
}

export function stackFonts(settings: AppearanceSettings) {
  const ui = pretextUiFace(settings);
  const code = pretextCodeFace(settings);
  return {
    ui: canvasFont({
      fontFamily: ui,
      fontSize: `${String(Math.max(11, settings.uiFontSize - 1))}px`,
    }),
    xs: canvasFont({
      fontFamily: ui,
      fontSize: `${String(Math.max(11, settings.uiFontSize - 2))}px`,
    }),
    header: canvasFont({
      fontFamily: ui,
      fontSize: `${String(settings.uiFontSize)}px`,
    }),
    code: canvasFont({
      fontFamily: code,
      fontSize: `${String(settings.codeFontSize)}px`,
    }),
  };
}

export function ChangesStack({
  items,
  scrollTop,
  focusPath,
  focusRevision,
  onScrollTop,
  onActivePath,
}: {
  readonly items: readonly ChangesStackItem[];
  readonly scrollTop: number;
  readonly focusPath: string | undefined;
  readonly focusRevision: number;
  readonly onScrollTop: (scrollTop: number) => void;
  readonly onActivePath: (path: string) => void;
}): ReactElement {
  const appearance = useAppearanceSettings();
  const [attachPane, paneWidth, paneHeight] = useClientBox();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const restore = useRef<number | undefined>(scrollTop);
  const appliedFocusRevision = useRef(0);
  const fonts = stackFonts(appearance);
  const uiLine = Math.max(12, appearance.uiFontSize + 3);
  const [collapsedPaths, setCollapsedPaths] = useState<readonly string[]>([]);
  const geometry = useMemo(() => {
    const gutter = stackedGutterWidth(
      paneWidth === 0 ? 24 : pretextNaturalWidth("0000", fonts.code),
    );
    const contentWidth = Math.max(0, paneWidth - gutter);
    const offsets = stackedOffsets(
      items.map((item) => ({
        path: item.path,
        height: collapsedPaths.includes(item.path)
          ? STACKED_HEADER_HEIGHT
          : stackedSectionHeight({
              section: item,
              contentWidth,
              measureHeight: (text, maxWidth) => {
                if (maxWidth <= 0) return STACKED_DIFF_LINE_HEIGHT;
                const notice = item.kind === "notice";
                return pretextLineHeight(
                  text,
                  notice ? fonts.ui : fonts.code,
                  maxWidth,
                  notice ? uiLine : STACKED_DIFF_LINE_HEIGHT,
                );
              },
            }),
      })),
    );
    return {
      offsets,
      scrollHeight: stackedScrollHeight(offsets),
    };
  }, [collapsedPaths, fonts.code, fonts.ui, items, paneWidth, uiLine]);
  const range = visibleStackedRange({
    offsets: geometry.offsets,
    scrollTop,
    viewport: paneHeight,
  });
  const tailHeight = stackTailHeight(geometry.offsets, range.end);

  useLayoutEffect(() => {
    const node = previewRef.current;
    const pending = restore.current;
    if (node === null || pending === undefined || paneWidth === 0) return;
    node.scrollTop = pending;
    restore.current = undefined;
  }, [paneWidth]);

  useLayoutEffect(() => {
    if (focusRevision === 0 || appliedFocusRevision.current === focusRevision || paneWidth === 0) {
      return;
    }
    const node = previewRef.current;
    if (node === null || focusPath === undefined) return;
    const entry = geometry.offsets.find((offset) => offset.path === focusPath);
    if (entry === undefined) return;
    appliedFocusRevision.current = focusRevision;
    node.scrollTop = entry.top;
    onScrollTop(entry.top);
  }, [focusPath, focusRevision, geometry.offsets, onScrollTop, paneWidth]);

  const attachPreview = (node: HTMLDivElement | null): void => {
    previewRef.current = node;
    attachPane(node);
  };

  const reportScroll = (top: number, viewport: number): void => {
    onScrollTop(top);
    const path = activeChangePath({
      offsets: geometry.offsets,
      scrollTop: top,
      viewport,
      scrollHeight: geometry.scrollHeight,
    });
    if (path !== undefined) onActivePath(path);
  };

  return (
    <div
      ref={attachPreview}
      data-nyte-scrollport="balanced"
      {...stylex.props(styles.preview)}
      onScroll={(event) =>
        reportScroll(event.currentTarget.scrollTop, event.currentTarget.clientHeight)
      }
    >
      <div {...stylex.props(styles.frame)} style={{ paddingBottom: STACKED_LIST_PADDING_END }}>
        {range.start > 0 && (
          <div aria-hidden="true" style={{ height: geometry.offsets[range.start]?.top ?? 0 }} />
        )}
        {items.slice(range.start, range.end).map((item, index) => {
          const offset = geometry.offsets[range.start + index];
          if (offset === undefined) return null;
          return (
            <StackSection
              key={item.path}
              item={item}
              offset={offset}
              collapsed={collapsedPaths.includes(item.path)}
              paneWidth={paneWidth}
              headerFont={fonts.header}
              xsFont={fonts.xs}
              onToggle={() => {
                setCollapsedPaths((current) =>
                  current.includes(item.path)
                    ? current.filter((path) => path !== item.path)
                    : [...current, item.path],
                );
              }}
            />
          );
        })}
        {tailHeight > 0 && <div aria-hidden="true" style={{ height: tailHeight }} />}
      </div>
    </div>
  );
}

function stackTailHeight(offsets: readonly StackedOffset[], end: number): number {
  const last = offsets.at(-1);
  const visible = offsets[end - 1];
  if (last === undefined || visible === undefined) return 0;
  return last.top + last.height - (visible.top + visible.height);
}

function stackHeaderPathWidth(paneWidth: number, statsWidth: number): number {
  const stats = statsWidth > 0 ? statsWidth + 8 : 0;
  return Math.max(0, paneWidth - 12 - 8 - 16 - 8 - stats);
}

function StackSection({
  item,
  offset,
  collapsed,
  paneWidth,
  headerFont,
  xsFont,
  onToggle,
}: {
  readonly item: ChangesStackItem;
  readonly offset: StackedOffset;
  readonly collapsed: boolean;
  readonly paneWidth: number;
  readonly headerFont: string;
  readonly xsFont: string;
  readonly onToggle: () => void;
}): ReactElement {
  const statsWidth =
    paneWidth === 0
      ? 0
      : diffMarksWidth({
          added: item.added,
          removed: item.removed,
          measure: (text) => pretextNaturalWidth(text, xsFont),
        });
  const pathWidth = stackHeaderPathWidth(paneWidth, statsWidth);
  const label = truncateStartText({
    text: item.path,
    maxWidth: pathWidth,
    fits: (value) => (pathWidth <= 0 ? true : pretextFitsWidth(value, headerFont, pathWidth)),
  });
  return (
    <div
      data-change-path={item.path}
      {...stylex.props(diffStyles.stackSection)}
      style={{ minHeight: offset.height }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${item.path}` : `Collapse ${item.path}`}
        title={item.path}
        {...stylex.props(diffStyles.stackHeader)}
        onClick={onToggle}
      >
        <span {...stylex.props(diffStyles.stackHeaderGlyph, diffStyles.stackHeaderIcon)}>
          <FileTypeIcon path={item.path} />
        </span>
        <span {...stylex.props(diffStyles.stackHeaderGlyph, diffStyles.stackHeaderChevron)}>
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </span>
        <span {...stylex.props(diffStyles.stackPath)}>{label}</span>
        {(item.added > 0 || item.removed > 0) && (
          <span
            aria-label={`${String(item.added)} added, ${String(item.removed)} removed`}
            {...stylex.props(diffStyles.stackStats)}
          >
            {item.added > 0 && (
              <span {...stylex.props(diffStyles.added)}>
                +<AnimatedNumber value={item.added} />
              </span>
            )}
            {item.removed > 0 && (
              <span {...stylex.props(diffStyles.removed)}>
                -<AnimatedNumber value={item.removed} />
              </span>
            )}
          </span>
        )}
      </button>
      {collapsed ? null : <StackSectionBody item={item} />}
    </div>
  );
}

function StackSectionBody({ item }: { readonly item: ChangesStackItem }): ReactElement | null {
  switch (item.kind) {
    case "diff":
      return <DiffView path={item.path} diff={item.parsed} variant="stack" />;
    case "raw":
      return <pre {...stylex.props(styles.raw)}>{item.text}</pre>;
    case "notice":
      return <div {...stylex.props(styles.notice)}>{item.text}</div>;
    case "pending":
      return null;
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}
