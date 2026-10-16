import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { role } from "@nyte-ai/ui/styles/vars.stylex";

export type Gap = 0 | 1 | 2 | 3 | 4 | 6;

const gaps = create({
  0: { gap: 0 },
  1: { gap: 4 },
  2: { gap: 8 },
  3: { gap: 12 },
  4: { gap: 16 },
  6: { gap: 24 },
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
    backgroundColor: role.borderPrimary,
  },
});

export function Divider(): ReactElement {
  return <hr {...props(divider.line)} />;
}
