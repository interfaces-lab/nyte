import type { Row } from "@nyte-ai/vt";

export interface CellPoint {
  readonly row: number;
  readonly column: number;
}

export interface TerminalLink {
  readonly url: string;
  /** First and last viewport cell of the link, inclusive. They differ in row when the terminal soft-wrapped it. */
  readonly start: CellPoint;
  readonly end: CellPoint;
}

const WEB_URL = /https?:\/\/[^\s<>"'`]+/gu;

/** Stands in for a cell that can't be part of a detected URL: a wide character, its tail or a cluster. */
const NOT_URL = " ";

/**
 * The web link under viewport cell `at`: an OSC 8 hyperlink from `hyperlink`, else a plain
 * `http(s)://` URL in the text of the line `at` sits on, joined across the rows the terminal
 * soft-wrapped. Only web links count, which is all the host opens.
 */
export function findLink(
  at: CellPoint,
  rowAt: (row: number) => Row | undefined,
  hyperlink: (cell: CellPoint) => string | null,
): TerminalLink | null {
  const cells = lineCells(at.row, rowAt);
  const index = cells.findIndex((cell) => cell.row === at.row && cell.column === at.column);

  if (index === -1) return null;
  const uri = hyperlink(at);

  if (uri !== null) {
    if (webUrl(uri) === null) return null;
    const first = linkEdge(index, -1, (next) => hyperlink(cells[next] ?? at) === uri, cells.length);
    const last = linkEdge(index, 1, (next) => hyperlink(cells[next] ?? at) === uri, cells.length);

    return { url: uri, start: cellPoint(cells[first], at), end: cellPoint(cells[last], at) };
  }

  const text = cells.map((cell) => cell.text).join("");

  return (
    Array.from(text.matchAll(WEB_URL), (match) => {
      const url = trimUrl(match[0]);

      return {
        url,
        first: match.index,
        last: match.index + url.length - 1,
      };
    })
      .filter((link) => index >= link.first && index <= link.last && webUrl(link.url) !== null)
      .map((link) => ({
        url: link.url,
        start: cellPoint(cells[link.first], at),
        end: cellPoint(cells[link.last], at),
      }))
      .at(0) ?? null
  );
}

/** Every cell of the line `row` belongs to, one URL character each, across soft-wrapped rows. */
function lineCells(row: number, rowAt: (row: number) => Row | undefined) {
  let top = row;

  while (rowAt(top - 1)?.wrapped === true) top -= 1;
  let bottom = row;

  while (rowAt(bottom)?.wrapped === true && rowAt(bottom + 1) !== undefined) bottom += 1;

  return Array.from({ length: bottom - top + 1 }, (_, offset) => rowAt(top + offset)).flatMap(
    (line) =>
      line?.cells.map((cell, column) => ({
        row: line.y,
        column,
        text: cell.width === 1 && cell.text.length <= 1 ? cell.text || " " : NOT_URL,
      })) ?? [],
  );
}

function cellPoint(cell: CellPoint | undefined, fallback: CellPoint): CellPoint {
  return cell === undefined ? fallback : { row: cell.row, column: cell.column };
}

function linkEdge(
  from: number,
  step: -1 | 1,
  same: (index: number) => boolean,
  length: number,
): number {
  let edge = from;

  while (edge + step >= 0 && edge + step < length && same(edge + step)) edge += step;

  return edge;
}

/** `value` as a URL when it's one the host opens, http or https. */
function webUrl(value: string): URL | null {
  const url = URL.parse(value);

  return url?.protocol === "https:" || url?.protocol === "http:" ? url : null;
}

/** Drops punctuation that ends the sentence around a URL, and a closing bracket it never opened. */
function trimUrl(url: string): string {
  const trimmed = url.replace(/[.,;:!?'"]+$/u, "");
  const opened = trimmed.split("(").length - 1;
  const closed = trimmed.split(")").length - 1;

  return trimmed.endsWith(")") && closed > opened ? trimUrl(trimmed.slice(0, -1)) : trimmed;
}
