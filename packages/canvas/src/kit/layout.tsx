import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export type Gap = 0 | 1 | 2 | 3 | 4 | 6;

const gaps = create({
  0: { gap: 0 },
  1: { gap: space.s1 },
  2: { gap: space.s2 },
  3: { gap: space.s3 },
  4: { gap: space.s4 },
  6: { gap: space.s6 },
});

const stack = create({
  base: { display: "flex", minWidth: 0 },
  column: { flexDirection: "column" },
  row: { flexDirection: "row" },
  wrap: { flexWrap: "wrap" },
  alignStart: { alignItems: "flex-start" },
  alignCenter: { alignItems: "center" },
  alignEnd: { alignItems: "flex-end" },
  alignStretch: { alignItems: "stretch" },
  justifyStart: { justifyContent: "flex-start" },
  justifyCenter: { justifyContent: "center" },
  justifyEnd: { justifyContent: "flex-end" },
  justifyBetween: { justifyContent: "space-between" },
});

const aligns = {
  start: stack.alignStart,
  center: stack.alignCenter,
  end: stack.alignEnd,
  stretch: stack.alignStretch,
} as const;

const justifies = {
  start: stack.justifyStart,
  center: stack.justifyCenter,
  end: stack.justifyEnd,
  between: stack.justifyBetween,
} as const;

export function Stack({
  direction = "column",
  gap = 2,
  align,
  justify,
  wrap = false,
  children,
}: {
  readonly direction?: "row" | "column";
  readonly gap?: Gap;
  readonly align?: keyof typeof aligns;
  readonly justify?: keyof typeof justifies;
  readonly wrap?: boolean;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      {...props(
        stack.base,
        stack[direction],
        gaps[gap],
        wrap && stack.wrap,
        align !== undefined && aligns[align],
        justify !== undefined && justifies[justify],
      )}
    >
      {children}
    </div>
  );
}

const grid = create({
  base: { display: "grid", minWidth: 0 },
  auto: (minWidth: number) => ({
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${String(minWidth)}px, 100%), 1fr))`,
  }),
  fixed: (columns: number) => ({
    gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
  }),
});

export function Grid({
  columns = "auto",
  minWidth = 160,
  gap = 2,
  children,
}: {
  readonly columns?: number | "auto";
  readonly minWidth?: number;
  readonly gap?: Gap;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      {...props(
        grid.base,
        gaps[gap],
        columns === "auto" ? grid.auto(minWidth) : grid.fixed(columns),
      )}
    >
      {children}
    </div>
  );
}

const divider = create({
  line: {
    borderStyle: "none",
    height: 1,
    margin: 0,
    alignSelf: "stretch",
    backgroundColor: role.strokeTertiary,
  },
});

export function Divider(): ReactElement {
  return <hr {...props(divider.line)} />;
}

const SIDE_BY_SIDE = "@container (min-width: 600px)";

const panes = create({
  root: { containerType: "inline-size", minWidth: 0 },
  grid: { position: "relative", display: "grid", minWidth: 0 },
  layout: (columns: string, rows: string, areas: string) => ({
    gridTemplateColumns: { default: "minmax(0, 1fr)", [SIDE_BY_SIDE]: columns },
    gridTemplateRows: { default: "none", [SIDE_BY_SIDE]: rows },
    gridTemplateAreas: { default: "none", [SIDE_BY_SIDE]: areas },
  }),
});

export function Panes({
  areas,
  rows,
  children,
}: {
  readonly areas: readonly string[];
  readonly rows?: readonly (number | "auto")[];
  readonly children?: ReactNode;
}): ReactElement {
  const columns = areas[0]?.trim().split(/\s+/u).length ?? 1;

  return (
    <div {...props(panes.root)}>
      <div
        {...props(
          panes.grid,
          hairline.startsAfter,
          panes.layout(
            `repeat(${String(columns)}, minmax(0, 1fr))`,
            areas
              .map((_row, index) => {
                const height = rows?.[index] ?? "auto";

                return height === "auto" ? "auto" : `${String(height)}px`;
              })
              .join(" "),
            areas.map((row) => `"${row}"`).join(" "),
          ),
        )}
      >
        {children}
      </div>
    </div>
  );
}

const pane = create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
  place: (area: string, height: string) => ({
    gridArea: { default: "auto", [SIDE_BY_SIDE]: area },
    height: { default: height, [SIDE_BY_SIDE]: "auto" },
  }),
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    minWidth: 0,
    minHeight: space.s6,
    paddingInline: space.s2,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  },
  title: {
    minWidth: 0,
    fontWeight: type.weightMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    marginInlineStart: "auto",
    color: role.contentTertiary,
  },
  body: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    paddingBlock: space.s1_5,
    paddingInline: space.s2,
  },
  flush: { padding: 0 },
});

export function Pane({
  area,
  title,
  actions,
  flush = false,
  height,
  children,
}: {
  readonly area: string;
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly flush?: boolean;
  readonly height?: number;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section
      {...props(
        pane.root,
        hairline.endsAfter,
        pane.place(area, height === undefined ? "auto" : `${String(height)}px`),
      )}
    >
      {title === undefined && actions === undefined ? null : (
        <header {...props(text.xs, pane.head, hairline.blockEnd)}>
          <span {...props(pane.title)}>{title}</span>
          {actions === undefined ? null : <span {...props(pane.actions)}>{actions}</span>}
        </header>
      )}
      <div {...props(pane.body, flush && pane.flush)}>{children}</div>
    </section>
  );
}
