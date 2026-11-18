import { create, props } from "@stylexjs/stylex";
import { Children } from "react";
import type { ReactElement, ReactNode } from "react";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { GRID_COLUMN_FLOOR, findLayoutRole, flowItems, pairFloor, snapStep } from "./floor.ts";
import type { FlowItem } from "./floor.ts";

export type Gap = 0 | 1 | 2 | 3 | 4 | 6;

const GAPS: readonly Gap[] = [0, 1, 2, 3, 4, 6];

const GAP_SPACE = {
  0: "0px",
  1: space.s1,
  2: space.s2,
  3: space.s3,
  4: space.s4,
  6: space.s6,
} as const;

const spacers = create({
  block: { flexShrink: 0 },
  1: { flexBasis: space.s1, blockSize: space.s1 },
  2: { flexBasis: space.s2, blockSize: space.s2 },
  3: { flexBasis: space.s3, blockSize: space.s3 },
  4: { flexBasis: space.s4, blockSize: space.s4 },
  6: { flexBasis: space.s6, blockSize: space.s6 },
  inline1: { flexBasis: space.s1 },
  inline2: { flexBasis: space.s2 },
  inline3: { flexBasis: space.s3 },
  inline4: { flexBasis: space.s4 },
  inline6: { flexBasis: space.s6 },
});

const INLINE_SPACERS = {
  1: spacers.inline1,
  2: spacers.inline2,
  3: spacers.inline3,
  4: spacers.inline4,
  6: spacers.inline6,
} as const;

export function spaceFlow(items: readonly FlowItem[], axis: "block" | "inline"): ReactNode[] {
  return items.flatMap((item, index) => {
    const step = snapStep(item.space, GAPS, 0);

    if (step === 0) return [item.node];

    return [
      <div
        key={`floor-${String(index)}`}
        aria-hidden="true"
        {...props(spacers.block, axis === "block" ? spacers[step] : INLINE_SPACERS[step])}
      />,
      item.node,
    ];
  });
}

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
  gap: asked = 2,
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
  const gap = snapStep(asked, GAPS, 2);
  const axis = direction === "row" ? "inline" : "block";
  const items = flowItems(children, gap, axis);

  const raised =
    wrap && items !== undefined
      ? snapStep(Math.max(...items.map((item) => item.space)), GAPS, gap)
      : gap;

  return (
    <div
      {...props(
        stack.base,
        stack[direction],
        gaps[items === undefined || wrap ? raised : 0],
        wrap && stack.wrap,
        align !== undefined && aligns[align],
        justify !== undefined && justifies[justify],
      )}
    >
      {items === undefined || wrap ? children : spaceFlow(items, axis)}
    </div>
  );
}

const grid = create({
  base: { display: "grid", minWidth: 0 },
  auto: (minWidth: number) => ({
    gridTemplateColumns: `repeat(auto-fill, minmax(min(${String(minWidth)}px, 100%), 1fr))`,
  }),
  fixed: (columns: number, gap: string) => ({
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, max(calc(${space.s1} * ${String(GRID_COLUMN_FLOOR)}), calc((100% - ${String(columns - 1)} * ${gap}) / ${String(columns)}))), 1fr))`,
  }),
});

export function Grid({
  columns: askedColumns = "auto",
  minWidth = 160,
  gap: asked = 2,
  children,
}: {
  readonly columns?: number | "auto";
  readonly minWidth?: number;
  readonly gap?: Gap;
  readonly children?: ReactNode;
}): ReactElement {
  const roles = Children.toArray(children).map(findLayoutRole);
  const floor = Math.max(0, ...roles.map((role) => pairFloor(role, role, "inline")));
  const gap = snapStep(Math.max(snapStep(asked, GAPS, 2), floor), GAPS, 2);
  const columns = askedColumns === "auto" ? Number.NaN : Math.round(Number(askedColumns));

  return (
    <div
      {...props(
        grid.base,
        gaps[gap],
        Number.isFinite(columns) && columns >= 1
          ? grid.fixed(columns, GAP_SPACE[gap])
          : grid.auto(Number.isFinite(Number(minWidth)) ? Number(minWidth) : 160),
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
