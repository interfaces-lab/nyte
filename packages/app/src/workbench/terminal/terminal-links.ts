import type { Screen } from "@nyte-ai/vt";

export interface CellPoint {
  readonly row: number;
  readonly column: number;
}

export interface TerminalLink {
  readonly url: string;
  readonly start: CellPoint;
  readonly end: CellPoint;
}

const WEB_URL = /https?:\/\/[^\s<>"'`]+/gu;

const NOT_URL = " ";

export function findLink(
  at: CellPoint,
  screen: Screen,
  hyperlink: (cell: CellPoint) => string | null,
): TerminalLink | null {
  const cells = lineCells(at.row, screen);
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

function lineCells(row: number, screen: Screen) {
  if (row < 0 || row >= screen.rows) return [];
  let top = row;

  while (top > 0 && screen.wrapped[top - 1] === 1) top -= 1;
  let bottom = row;

  while (bottom + 1 < screen.rows && screen.wrapped[bottom] === 1) bottom += 1;

  return Array.from({ length: bottom - top + 1 }, (_, offset) => top + offset).flatMap((y) =>
    Array.from({ length: screen.cols }, (_, column) => {
      const index = y * screen.cols + column;
      const text = screen.text(index);

      return {
        row: y,
        column,
        text: screen.width[index] === 1 && text.length <= 1 ? text || " " : NOT_URL,
      };
    }),
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

function webUrl(value: string): URL | null {
  const url = URL.parse(value);

  return url?.protocol === "https:" || url?.protocol === "http:" ? url : null;
}

function trimUrl(url: string): string {
  const trimmed = url.replace(/[.,;:!?'"]+$/u, "");
  const opened = trimmed.split("(").length - 1;
  const closed = trimmed.split(")").length - 1;

  return trimmed.endsWith(")") && closed > opened ? trimUrl(trimmed.slice(0, -1)) : trimmed;
}
