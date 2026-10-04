export const REVISION = "f48720a4934d70f10ecdf3a2bcbae9b49f221032";

export const KERNEL = "core/src/kernel";

export function sourceUrl(path: string, line?: number, end?: number): string {
  const anchor = line === undefined ? "" : `#L${line}${end === undefined ? "" : `-L${end}`}`;

  return `https://github.com/interfaces-lab/nyte/blob/${REVISION}/packages/${path}${anchor}`;
}

export function sourceLabel(path: string, line?: number, end?: number): string {
  const name = path.split("/").at(-1) ?? path;

  if (line === undefined) return name;

  return end === undefined ? `${name}:${line}` : `${name}:${line}–${end}`;
}
