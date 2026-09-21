"use client";

import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { table } from "./lab.stylex";
import { TOKEN_ROWS } from "./token-map";
import type { TokenRow } from "./token-map";

export type Source = "nyte" | "nds";

/**
 * A swatch reads the value; the label reads a short form of it. Shadows and
 * weights have no useful colour, so they show the sample and a trimmed string
 * rather than the full declaration, which is long enough to break the column.
 */
function preview(row: TokenRow, value: string): string {
  if (row.kind === "shadow") return value.split(",")[0]?.trim() ?? value;
  return value;
}

function Chip({ row, value }: { readonly row: TokenRow; readonly value: string }): ReactElement {
  if (row.kind === "scalar") return <span {...stylex.props(table.weight)}>{value}</span>;
  if (row.kind === "shadow") {
    return <span {...stylex.props(table.shadowChip)} style={{ boxShadow: value }} />;
  }
  return <span {...stylex.props(table.swatch)} style={{ background: value }} />;
}

function Choice({
  row,
  source,
  side,
  onPick,
}: {
  readonly row: TokenRow;
  readonly source: Source;
  readonly side: Source;
  readonly onPick: () => void;
}): ReactElement {
  const value = side === "nyte" ? row.nyte : row.nds;
  return (
    <button
      type="button"
      aria-pressed={source === side}
      title={value}
      {...stylex.props(table.choice, source === side && table.choiceOn)}
      onClick={onPick}
    >
      <Chip row={row} value={value} />
      {row.kind !== "scalar" && <span {...stylex.props(table.value)}>{preview(row, value)}</span>}
    </button>
  );
}

/**
 * One row per disagreement, each toggling a single custom property on the
 * frame. Isolating one decision is the only way to tell which of them is
 * doing the work.
 */
export function TokenTable({
  sources,
  onChange,
  onSetAll,
}: {
  readonly sources: Readonly<Record<string, Source>>;
  readonly onChange: (id: string, source: Source) => void;
  readonly onSetAll: (source: Source) => void;
}): ReactElement {
  const ndsCount = TOKEN_ROWS.filter((row) => (sources[row.id] ?? "nds") === "nds").length;

  return (
    <section {...stylex.props(table.root)}>
      <header {...stylex.props(table.header)}>
        <h2 {...stylex.props(table.title)}>Token by token</h2>
        <p {...stylex.props(table.count)}>
          {ndsCount} of {TOKEN_ROWS.length} on NDS
        </p>
        <div {...stylex.props(table.bulk)}>
          <button
            type="button"
            {...stylex.props(table.bulkButton)}
            onClick={() => onSetAll("nyte")}
          >
            All Nyte
          </button>
          <button type="button" {...stylex.props(table.bulkButton)} onClick={() => onSetAll("nds")}>
            All NDS
          </button>
        </div>
      </header>

      <div {...stylex.props(table.head)}>
        <span>Role</span>
        <span>Nyte today</span>
        <span>NDS</span>
      </div>

      <ul {...stylex.props(table.list)}>
        {TOKEN_ROWS.map((row) => {
          const source = sources[row.id] ?? "nds";
          return (
            <li key={row.id} {...stylex.props(table.row)}>
              <span {...stylex.props(table.role)}>{row.role}</span>
              <Choice
                row={row}
                source={source}
                side="nyte"
                onPick={() => onChange(row.id, "nyte")}
              />
              <Choice row={row} source={source} side="nds" onPick={() => onChange(row.id, "nds")} />
              <p {...stylex.props(table.note)}>{row.note}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
