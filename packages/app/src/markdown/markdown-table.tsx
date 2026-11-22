import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableResizer,
  TableRow,
  tableFeatures,
  useTable,
} from "@nyte-ai/ui/table";
import type { ReactElement } from "react";

export interface MarkdownCell {
  readonly html: string;
  readonly align: "start" | "center" | "end";
}

export type MarkdownRow = readonly MarkdownCell[];

const features = tableFeatures({ columnSizingFeature, columnResizingFeature });

const helper = createColumnHelper<typeof features, MarkdownRow>();

const EMPTY: MarkdownCell = { html: "", align: "start" };

export function MarkdownTable({
  head,
  rows,
}: {
  readonly head: MarkdownRow;
  readonly rows: readonly MarkdownRow[];
}): ReactElement {
  const columns = helper.columns(head.map((_, index) => helper.display({ id: String(index) })));

  const table = useTable({
    features,
    columns,
    data: rows,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 48 },
  });

  const fixed = Object.keys(table.state.columnSizing).length > 0;

  return (
    <Table width={fixed ? table.getTotalSize() : undefined}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id} align={head[header.index]?.align} width={header.getSize()}>
                <Html html={head[header.index]?.html ?? ""} />
                <TableResizer header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell, index) => {
              const value = row.original[index] ?? EMPTY;

              return (
                <TableCell key={cell.id} align={value.align}>
                  <Html html={value.html} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Html({ html }: { readonly html: string }): ReactElement {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
