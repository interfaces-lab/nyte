import { intent } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * The page's reading primitives: section, heading, prose, inline code,
 * source link, table. Layout and type only, on `@nyte-ai/ui` tokens; every
 * control on the page is a `@nyte-ai/ui` component.
 */
import { create, props } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Fragment, type ReactNode } from "react";
import { KERNEL, sourceLabel, sourceUrl } from "./source";

const styles = create({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBlockStart: 48,
    scrollMarginBlockStart: 16,
  },
  eyebrow: {
    margin: 0,
    marginBlockEnd: -8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
  },
  h2: {
    margin: 0,
    fontSize: type.font2xl,
    lineHeight: "26px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  h3: {
    margin: 0,
    marginBlockStart: 12,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    fontWeight: 590,
    scrollMarginBlockStart: 16,
  },
  /* Prose keeps a reading measure; code, tables and figures take the full column. */
  p: { maxWidth: 700, margin: 0, textWrap: "pretty" },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxWidth: 700,
    margin: 0,
    paddingInlineStart: 20,
  },
  code: {
    paddingInline: "0.25em",
    paddingBlock: "0.08em",
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    fontFamily: type.fontMono,
    fontSize: "0.86em",
    /* Mono metrics would otherwise open up every line a chip sits on. */
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  src: {
    fontFamily: type.fontMono,
    fontSize: "0.8em",
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  link: {
    color: role.contentSecondary,
    textDecorationLine: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 2,
  },
  tableWrap: { overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  th: {
    paddingBlock: 6,
    paddingInlineEnd: 16,
    textAlign: "start",
    verticalAlign: "bottom",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
    whiteSpace: "nowrap",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderPrimaryTranslucent,
  },
  td: {
    textWrap: "pretty",
    paddingBlock: 6,
    paddingInlineEnd: 16,
    verticalAlign: "top",
    borderBlockEndWidth: { default: 1, ":is(tr:last-child > *)": 0 },
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
  },
  nowrap: { whiteSpace: "nowrap" },
  fixed: { tableLayout: "fixed" },
  column: (width: string) => ({ width }),
});

export function Section(input: {
  readonly id: string;
  /** Shown on the first section of each group only. */
  readonly group?: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={input.id} aria-labelledby={`${input.id}-title`} {...props(styles.section)}>
      {input.group !== undefined && <p {...props(styles.eyebrow)}>{input.group}</p>}
      <h2 id={`${input.id}-title`} {...props(styles.h2)}>
        {input.title}
      </h2>
      {input.children}
    </section>
  );
}

export function H3(input: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h3 id={input.id} {...props(styles.h3)}>
      {input.children}
    </h3>
  );
}

export function P(input: { readonly children: ReactNode }) {
  return <p {...props(styles.p)}>{input.children}</p>;
}

export function List(input: { readonly ordered?: boolean; readonly children: ReactNode }) {
  return input.ordered === true ? (
    <ol {...props(styles.list)}>{input.children}</ol>
  ) : (
    <ul {...props(styles.list)}>{input.children}</ul>
  );
}

/** Inline code. */
export function C(input: { readonly children: ReactNode }) {
  return <code {...props(styles.code)}>{input.children}</code>;
}

/** Plain text with `backticked` spans set as inline code, for table data written as strings. */
export function Inline(input: { readonly text: string }) {
  return input.text
    .split("`")
    .map((part, index) => (index % 2 === 1 ? <C key={index}>{part}</C> : part));
}

/** Several inline codes as a list, each comma kept on its code's line. */
export function Codes(input: { readonly items: readonly string[] }) {
  return input.items.map((item, index) => (
    <Fragment key={item}>
      {index > 0 && " "}
      <span {...props(styles.nowrap)}>
        <C>{item}</C>
        {index < input.items.length - 1 && ","}
      </span>
    </Fragment>
  ));
}

/** A link into the page. */
export function To(input: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={input.href} {...props([intent.primary, styles.link])}>
      {input.children}
    </a>
  );
}

/** A kernel file and line, linked at the pinned revision. `path` is relative to the kernel. */
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
      {...props(styles.src)}
    >
      {sourceLabel(path, input.line)} <span aria-hidden>↗</span>
    </a>
  );
}

/**
 * `nowrap` lists the columns that must not wrap, the first by default.
 * `widths` fixes the columns, so tables stacked under one heading line up.
 */
export function Table(input: {
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
  readonly nowrap?: readonly number[];
  readonly widths?: readonly string[];
}) {
  const nowrap = input.nowrap ?? [0];

  return (
    <div {...props(styles.tableWrap)}>
      <table {...props(styles.table, input.widths !== undefined && styles.fixed)}>
        {input.widths !== undefined && (
          <colgroup>
            {input.widths.map((width, index) => (
              <col key={index} {...props(styles.column(width))} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {input.head.map((cell) => (
              <th key={cell} scope="col" {...props(styles.th)}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} {...props(styles.td, nowrap.includes(column) && styles.nowrap)}>
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
