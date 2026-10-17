import { Table } from "nyte/canvas";
import { GRAPH, HUBS, ROOT } from "./graph.ts";
import type { Import, Star } from "./graph.ts";

/** The focused star's importers and imports, each linking to its file at the line, or the most imported modules when nothing is focused. */
export function Details({ star }: { readonly star: Star | undefined }) {
  if (star === undefined)
    return (
      <Table
        caption="Most imported"
        columns={[
          { key: "module", label: "Module" },
          { key: "count", label: "Importers", align: "end" },
        ]}
        rows={HUBS.map((hub) => ({ module: hub.label, count: hub.importers.length }))}
      />
    );
  const cell = (edge: Import | undefined, outgoing: boolean) => {
    const other = edge === undefined ? undefined : GRAPH.stars[outgoing ? edge.to : edge.from];
    const path = outgoing ? star.path : other?.path;

    if (edge === undefined || other === undefined) return "";
    const text = outgoing ? other.label : `${other.label}:${edge.line}`;

    return path === null || path === undefined ? (
      text
    ) : (
      <a href={`${ROOT}${path}:${edge.line}`}>{text}</a>
    );
  };
  const rows = [0, 1, 2, 3, 4].map((index) => ({
    by: cell(star.importers[index], false),
    to: cell(star.imports[index], true),
  }));

  return (
    <Table
      caption={
        star.path === null
          ? `${star.label}, a workspace package`
          : `${star.label} · ${star.lines} lines · ${star.exports} exports`
      }
      columns={[
        { key: "by", label: `Imported by (${star.importers.length})`, width: "50%" },
        { key: "to", label: `Imports (${star.imports.length})` },
      ]}
      rows={rows}
    />
  );
}
