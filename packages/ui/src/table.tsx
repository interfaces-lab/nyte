import { create, props } from "@stylexjs/stylex";
import type { ColumnSizingState } from "@tanstack/react-table";
import { createContext, use } from "react";
import type {
  ComponentProps,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  TouchEvent as ReactTouchEvent,
} from "react";

import { hairline } from "./styles/hairline.stylex.ts";
import { media, radius, space, table } from "./styles/schema.stylex.ts";
import { text } from "./styles/text.stylex.ts";
import { role, type } from "./styles/vars.stylex.ts";

export {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

export type { ColumnSizingState } from "@tanstack/react-table";

const CALC_SIZE = "@supports (width: calc-size(auto, size))";

const styles = create({
  container: {
    width: "fit-content",
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "hidden",
    borderRadius: radius.control,
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  fixed: (width: number) => ({ width, tableLayout: "fixed" }),
  cell: {
    boxSizing: "border-box",
    position: "relative",
    paddingBlock: `calc((${table.rowHeight} - ${type.leadingBase}) / 2)`,
    paddingInline: space.s2_5,
    textAlign: "start",
    verticalAlign: "top",
  },
  head: { backgroundColor: role.bgMutedTranslucent, fontWeight: type.weightSemibold },
  center: { textAlign: "center" },
  end: { textAlign: "end" },
  width: (width: number) => ({ width }),
  content: {
    minWidth: {
      default: null,
      [CALC_SIZE]: `calc-size(max-content, min(size, ${table.wrapWidth}))`,
    },
    overflowWrap: { default: "break-word", [CALC_SIZE]: "anywhere" },
  },
  fixedContent: { minWidth: 0, overflowWrap: "anywhere" },
  measure: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: "max-content",
    minWidth: 0,
    maxWidth: "none",
    visibility: "hidden",
    pointerEvents: "none",
  },
  resizer: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: { default: `calc(${space.s1} * -1)`, ":is(:last-child > * > *)": 0 },
    zIndex: 1,
    width: space.s2,
    cursor: "col-resize",
    touchAction: "none",
    userSelect: "none",
    "--_table-resizer-line": { default: null, ":hover": { [media.hover]: role.strokeSecondary } },
    "::after": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      insetInline: 0,
      width: `calc(${space.px} * 2)`,
      marginInline: "auto",
      backgroundColor: "var(--_table-resizer-line, transparent)",
    },
  },
  resizing: { "--_table-resizer-line": role.strokeAccent },
});

const measureClass = props(styles.measure).className ?? "";

const Layout = createContext<"auto" | "fixed">("auto");

type Align = "start" | "center" | "end";

export type TableProps = Omit<ComponentProps<"table">, "className" | "style" | "width"> & {
  /** Fixes the layout to this many pixels; the columns take their `TableHead` widths. */
  readonly width?: number | undefined;
};

/** A framed table that keeps each column at a readable width and scrolls sideways when they don't fit. */
export function Table({ width, ...rest }: TableProps): ReactElement {
  return (
    <div
      data-slot="table-container"
      data-nyte-scrollport
      {...props(styles.container, hairline.ring)}
    >
      <Layout value={width === undefined ? "auto" : "fixed"}>
        <table
          data-slot="table"
          {...rest}
          {...props(text.base, styles.table, width !== undefined && styles.fixed(width))}
        />
      </Layout>
    </div>
  );
}

export function TableHeader(rest: ComponentProps<"thead">): ReactElement {
  return <thead data-slot="table-header" {...rest} />;
}

export function TableBody(rest: ComponentProps<"tbody">): ReactElement {
  return <tbody data-slot="table-body" {...rest} />;
}

export function TableRow(rest: ComponentProps<"tr">): ReactElement {
  return <tr data-slot="table-row" {...rest} />;
}

export type TableHeadProps = Omit<
  ComponentProps<"th">,
  "align" | "className" | "style" | "width"
> & {
  readonly align?: Align;
  /** The column's width in pixels when the table is fixed. */
  readonly width?: number | undefined;
};

export function TableHead({
  align = "start",
  width,
  children,
  ...rest
}: TableHeadProps): ReactElement {
  const fixed = use(Layout) === "fixed";

  return (
    <th
      data-slot="table-head"
      {...rest}
      {...props(
        styles.cell,
        hairline.tableCell,
        styles.head,
        alignment(align),
        fixed && width !== undefined && styles.width(width),
      )}
    >
      <div data-slot="table-content" {...props(fixed ? styles.fixedContent : styles.content)}>
        {children}
      </div>
    </th>
  );
}

export type TableCellProps = Omit<ComponentProps<"td">, "align" | "className" | "style"> & {
  readonly align?: Align;
};

export function TableCell({ align = "start", children, ...rest }: TableCellProps): ReactElement {
  const fixed = use(Layout) === "fixed";

  return (
    <td
      data-slot="table-cell"
      {...rest}
      {...props(styles.cell, hairline.tableCell, alignment(align))}
    >
      <div data-slot="table-content" {...props(fixed ? styles.fixedContent : styles.content)}>
        {children}
      </div>
    </td>
  );
}

function alignment(align: Align) {
  return align === "center" ? styles.center : align === "end" && styles.end;
}

/** The slice of a TanStack header with `columnSizingFeature` and `columnResizingFeature` that a resizer drives. */
export interface ResizableHeader {
  readonly column: { readonly id: string; getIsResizing(): boolean };
  readonly headerGroup: {
    readonly headers: readonly { readonly column: { readonly id: string } }[];
  } | null;
  getResizeHandler(): (event: ReactMouseEvent | ReactTouchEvent) => void;
  getContext(): {
    readonly table: {
      setColumnSizing(updater: (sizing: ColumnSizingState) => ColumnSizingState): void;
    };
  };
}

/**
 * The edge of a header cell. Dragging resizes its column and double-clicking fits the column to
 * its content without wrapping. Either one first pins every column at its rendered width, so a
 * table that sized itself from its content holds still while one column changes.
 */
export function TableResizer({ header }: { readonly header: ResizableHeader }): ReactElement {
  const start = (event: ReactMouseEvent<HTMLElement> | ReactTouchEvent<HTMLElement>): void => {
    pin(header, event.currentTarget);
    header.getResizeHandler()(event);
  };

  return (
    <div
      aria-hidden="true"
      data-slot="table-resizer"
      {...props(styles.resizer, header.column.getIsResizing() && styles.resizing)}
      onMouseDown={(event) => {
        event.preventDefault();
        start(event);
      }}
      onTouchStart={start}
      onDoubleClick={(event) => fit(header, event.currentTarget)}
    />
  );
}

function pin(header: ResizableHeader, handle: HTMLElement): void {
  const cells = [...(handle.closest("tr")?.cells ?? [])];

  const sizes = (header.headerGroup?.headers ?? []).map((leaf, index) => [
    leaf.column.id,
    cells[index]?.getBoundingClientRect().width ?? 0,
  ]);

  header
    .getContext()
    .table.setColumnSizing((sizing) => ({ ...Object.fromEntries(sizes), ...sizing }));
}

function fit(header: ResizableHeader, handle: HTMLElement): void {
  const head = handle.closest("th");
  const rows = head?.closest("table")?.rows;

  if (head === null || rows === undefined) return;
  const cells = [...rows].flatMap((row) => row.cells[head.cellIndex] ?? []);
  const width = Math.ceil(Math.max(...cells.map(naturalWidth)));

  pin(header, handle);
  header.getContext().table.setColumnSizing((sizing) => ({ ...sizing, [header.column.id]: width }));
}

function naturalWidth(cell: HTMLTableCellElement): number {
  const content = cell.querySelector<HTMLElement>(':scope > [data-slot="table-content"]');

  if (content === null) return cell.getBoundingClientRect().width;
  const clone = content.cloneNode(true);

  if (!(clone instanceof HTMLElement)) return cell.getBoundingClientRect().width;
  clone.className = measureClass;
  cell.append(clone);

  const width =
    clone.getBoundingClientRect().width +
    cell.getBoundingClientRect().width -
    content.getBoundingClientRect().width;

  clone.remove();

  return width;
}
