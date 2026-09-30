/** The commit every excerpt, patch and line link on the page was read at. */
export const REVISION = "f48720a4934d70f10ecdf3a2bcbae9b49f221032";

export const KERNEL = "core/src/kernel";

/** `path` is relative to `packages/`. */
export function sourceUrl(path: string, line?: number, end?: number): string {
  const anchor = line === undefined ? "" : `#L${line}${end === undefined ? "" : `-L${end}`}`;

  return `https://github.com/interfaces-lab/nyte/blob/${REVISION}/packages/${path}${anchor}`;
}

/** The file name, with the line when there is one: `step.ts:1124`. */
export function sourceLabel(path: string, line?: number, end?: number): string {
  const name = path.split("/").at(-1) ?? path;

  if (line === undefined) return name;

  return end === undefined ? `${name}:${line}` : `${name}:${line}–${end}`;
}
