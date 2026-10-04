import { Fragment, type ReactNode } from "react";
import { KERNEL, sourceLabel, sourceUrl } from "./source";

export function C({ children }: { readonly children: ReactNode }) {
  return <code>{children}</code>;
}

export function P({ children }: { readonly children: ReactNode }) {
  return <p>{children}</p>;
}

export function Inline({ text }: { readonly text: string }) {
  return text.split("`").map((part, index) => (index % 2 === 1 ? <C key={index}>{part}</C> : part));
}

export function Codes({ items }: { readonly items: readonly string[] }) {
  return items.map((item, index) => (
    <Fragment key={item}>
      {index > 0 && " "}
      <span className="whitespace-nowrap">
        <C>{item}</C>
        {index < items.length - 1 && ","}
      </span>
    </Fragment>
  ));
}

export function To({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return <a href={href}>{children}</a>;
}

export function Src(input: {
  readonly path: string;
  readonly line?: number;
  readonly root?: string;
}) {
  const path = `${input.root ?? KERNEL}/${input.path}`;
  return (
    <a
      href={sourceUrl(path, input.line)}
      target="_blank"
      rel="noreferrer"
      title={`packages/${path}`}
      className="font-mono text-xs"
    >
      {sourceLabel(path, input.line)} <span aria-hidden>↗</span>
    </a>
  );
}

export function Table(input: {
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
  readonly nowrap?: readonly number[];
  readonly widths?: readonly string[];
}) {
  const nowrap = input.nowrap ?? [0];
  return (
    <div className="doc-table-scroll">
      <table>
        {input.widths && (
          <colgroup>
            {input.widths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {input.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={nowrap.includes(column) ? "whitespace-nowrap" : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
