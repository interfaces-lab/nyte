import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * Code on the page, in two forms. `Source` is a verbatim excerpt with its
 * line numbers and a link to the line; `Sketch` is a summary written for the
 * page, labelled so it is never mistaken for source. `Diff` draws a unified
 * patch against the pinned revision, with the changed span of a replaced
 * line marked inside it.
 */
import { create, props } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Fragment, useMemo, type ReactNode } from "react";
import type { Excerpt } from "./excerpts";
import type { Patch } from "./patches";
import { tokenize, type Line, type Role } from "./highlight";
import { sourceLabel, sourceUrl } from "./source";

const styles = create({
  figure: { display: "flex", flexDirection: "column", gap: 8, margin: 0, minWidth: 0 },
  caption: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentSecondary,
    fontWeight: 500,
  },
  path: { fontFamily: type.fontMono, fontSize: type.fontXs, fontWeight: 400 },
  meta: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  link: {
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    textDecoration: "none",
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
  pre: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: 8,
    overflow: "hidden",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: "20px",
    tabSize: 2,
  },
  /* Rows are the pre's flex items; the newlines between them are for copying and are not laid out. */
  code: { display: "contents", font: "inherit" },
  row: { display: "flex" },
  inset: { paddingInlineStart: 12 },
  gutter: {
    flexShrink: 0,
    paddingInlineStart: 12,
    paddingInlineEnd: 12,
    textAlign: "end",
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  },
  gutterOld: { paddingInlineEnd: 0 },
  /* Border-box: the digits plus whatever padding the column keeps. */
  gutterWidth: (digits: number, padding: number) => ({ width: `calc(${digits}ch + ${padding}px)` }),
  sign: { flexShrink: 0, width: "2ch", color: role.contentTertiary, userSelect: "none" },
  text: {
    flexGrow: 1,
    minWidth: 0,
    paddingInlineEnd: 12,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  /* A wrapped line continues four columns in from its own indent, clear of the next nested line. */
  hang: (indent: number) => ({
    paddingInlineStart: `${indent}ch`,
    textIndent: `-${indent}ch`,
  }),
  addedRow: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 2px 0 0 ${role.contentInteractiveTertiary}`,
  },
  removedRow: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 2px 0 0 ${role.contentInteractiveTertiary}`,
  },
  addedWord: {
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    borderRadius: radius.indicator,
  },
  removedWord: {
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    borderRadius: radius.indicator,
  },
  /* The skipped lines between hunks: a quiet band in the code's own columns, naming where it resumes. */
  gap: { marginBlock: 4, backgroundColor: role.bgHover, opacity: 0.75 },
});

/** The span of a replaced line that differs from its pair. */
interface Mark {
  readonly start: number;
  readonly end: number;
  readonly added: boolean;
}

/** Readable hues for code; comments stay in the content ramp, set apart by slant. */
const roles = create({
  plain: {},
  keyword: { color: role.contentSecondary },
  string: { color: role.contentSecondary },
  function: { color: role.contentSecondary },
  constant: { color: role.contentSecondary },
  comment: { color: role.contentSecondary, fontStyle: "italic" },
  punctuation: { color: role.contentSecondary },
});

const syntaxScopes = {
  plain: [],
  keyword: surfaceTheme.purple,
  string: surfaceTheme.green,
  function: surfaceTheme.blue,
  constant: surfaceTheme.teal,
  comment: [],
  punctuation: [],
};

function roleStyle(syntaxRole: Role) {
  return [syntaxScopes[syntaxRole], roles[syntaxRole]];
}

/** A line's tokens, with `[start, end)` of its text wrapped in `mark`. */
function Tokens(input: { readonly line: Line; readonly mark?: Mark }): ReactNode {
  const { mark } = input;
  let offset = 0;

  return input.line.flatMap((token, index) => {
    const from = offset;
    offset += token.text.length;

    if (mark === undefined || mark.start === mark.end || mark.end <= from || mark.start >= offset) {
      return [
        <span key={index} {...props(roleStyle(token.role))}>
          {token.text}
        </span>,
      ];
    }

    const start = Math.max(mark.start, from) - from;
    const end = Math.min(mark.end, offset) - from;
    const word = mark.added
      ? [intent.success, styles.addedWord]
      : [intent.danger, styles.removedWord];

    return [
      <span key={`${index}a`} {...props(roleStyle(token.role))}>
        {token.text.slice(0, start)}
      </span>,
      <span key={`${index}b`} {...props(word)}>
        <span {...props(roleStyle(token.role))}>{token.text.slice(start, end)}</span>
      </span>,
      <span key={`${index}c`} {...props(roleStyle(token.role))}>
        {token.text.slice(end)}
      </span>,
    ];
  });
}

function indentOf(line: Line): number {
  const text = line.map((token) => token.text).join("");

  return text.length - text.trimStart().length;
}

function CodeText(input: { readonly line: Line; readonly mark?: Mark }) {
  return (
    <span {...props(styles.text, styles.hang(indentOf(input.line) + 4))}>
      <Tokens line={input.line} mark={input.mark} />
    </span>
  );
}

function Frame(input: {
  readonly label: string;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <figure aria-label={input.label} {...props(styles.figure)}>
      <figcaption {...props(styles.caption)}>
        <span {...props(styles.title)}>{input.title}</span>
        <span {...props(styles.meta)}>{input.meta}</span>
      </figcaption>
      <pre {...props(styles.pre)}>
        <code {...props(styles.code)}>{input.children}</code>
      </pre>
    </figure>
  );
}

function SourceLink(input: {
  readonly path: string;
  readonly line: number;
  readonly end?: number;
}) {
  return (
    <a
      href={sourceUrl(input.path, input.line, input.end)}
      target="_blank"
      rel="noreferrer"
      {...props(styles.link)}
    >
      {sourceLabel(input.path, input.line, input.end)} <span aria-hidden>↗</span>
    </a>
  );
}

/** A verbatim excerpt: numbered from its first line, linked to its range. */
export function Source(input: { readonly title: string; readonly excerpt: Excerpt }) {
  const { excerpt } = input;
  const lines = useMemo(() => tokenize(excerpt.code), [excerpt.code]);
  const last = excerpt.line + lines.length - 1;
  const digits = String(last).length;

  return (
    <Frame
      label={`${input.title}, ${sourceLabel(excerpt.path, excerpt.line, last)}`}
      title={input.title}
      meta={<SourceLink path={excerpt.path} line={excerpt.line} end={last} />}
    >
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          <span {...props(styles.row)}>
            <span {...props(styles.gutter, styles.gutterWidth(digits, 24))}>
              {excerpt.line + index}
            </span>
            <CodeText line={line} />
          </span>
        </Fragment>
      ))}
    </Frame>
  );
}

/** A summary written for this page. Never numbered: it is not a file. */
export function Sketch(input: { readonly title: string; readonly code: string }) {
  const lines = useMemo(() => tokenize(input.code), [input.code]);

  return (
    <Frame label={`${input.title}, sketch`} title={input.title} meta="Sketch">
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          <span {...props(styles.row, styles.inset)}>
            <CodeText line={line} />
          </span>
        </Fragment>
      ))}
    </Frame>
  );
}

type RowKind = "context" | "added" | "removed";

interface DiffRow {
  readonly kind: RowKind;
  readonly before?: number;
  readonly after?: number;
  readonly line: Line;
  readonly mark?: Mark;
}

interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly context: string;
  readonly rows: readonly DiffRow[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/u;

/**
 * The span two versions of a line disagree on, and how many characters they
 * share around it, not counting indentation.
 */
function changedSpan(before: string, after: string) {
  let start = 0;

  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;

  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const indent = before.length - before.trimStart().length;
  const shared = start - Math.min(start, indent) + (before.length - beforeEnd);

  return { start, beforeEnd, afterEnd, shared };
}

/** Tokens for `code` as they read after `prelude`, which is tokenized and dropped. */
function tokenizeAfter(prelude: string, code: string): readonly Line[] {
  if (prelude === "") return tokenize(code);

  return tokenize(`${prelude}\n${code}`).slice(prelude.split("\n").length);
}

/** Removes `count` leading columns, which are indentation, from a line's tokens. */
function dropColumns(line: Line, count: number): Line {
  let remaining = count;

  return line.flatMap((token) => {
    if (remaining >= token.text.length) {
      remaining -= token.text.length;

      return [];
    }

    const kept = remaining === 0 ? token : { ...token, text: token.text.slice(remaining) };
    remaining = 0;

    return [kept];
  });
}

function parseHunks(patch: Patch): readonly Hunk[] {
  const hunks: { header: RegExpMatchArray; body: string[] }[] = [];

  for (const text of patch.patch.split("\n")) {
    const header = text.match(HUNK_HEADER);

    if (header !== null) hunks.push({ header, body: [] });
    else if (text.length > 0) hunks.at(-1)?.body.push(text);
  }

  // Every hunk loses the indentation all of them share, so a change deep in a
  // function starts at the left edge instead of halfway across the well.
  const indent = Math.min(
    ...hunks.flatMap(({ body }) =>
      body.flatMap((text) => {
        const content = text.slice(1);

        return content.trim() === "" ? [] : [content.length - content.trimStart().length];
      }),
    ),
  );

  return hunks.map(({ header, body }, index) => {
    const oldStart = Number(header[1]);
    const newStart = Number(header[2]);
    const prelude = patch.preludes[index];
    const before = tokenizeAfter(
      prelude?.before ?? "",
      body
        .filter((text) => !text.startsWith("+"))
        .map((text) => text.slice(1))
        .join("\n"),
    );
    const after = tokenizeAfter(
      prelude?.after ?? "",
      body
        .filter((text) => !text.startsWith("-"))
        .map((text) => text.slice(1))
        .join("\n"),
    );
    const rows: DiffRow[] = [];
    let oldIndex = 0;
    let newIndex = 0;

    for (const text of body) {
      if (text.startsWith("-")) {
        rows.push({ kind: "removed", before: oldStart + oldIndex, line: before[oldIndex] ?? [] });
        oldIndex += 1;
      } else if (text.startsWith("+")) {
        rows.push({ kind: "added", after: newStart + newIndex, line: after[newIndex] ?? [] });
        newIndex += 1;
      } else {
        rows.push({
          kind: "context",
          before: oldStart + oldIndex,
          after: newStart + newIndex,
          line: after[newIndex] ?? [],
        });
        oldIndex += 1;
        newIndex += 1;
      }
    }

    const dedented = markReplacements(rows, body).map((row) => ({
      ...row,
      line: dropColumns(row.line, indent),
      mark:
        row.mark === undefined
          ? undefined
          : {
              ...row.mark,
              start: Math.max(0, row.mark.start - indent),
              end: Math.max(0, row.mark.end - indent),
            },
    }));

    return { oldStart, newStart, context: header[3] ?? "", rows: dedented };
  });
}

/**
 * Pairs each removed line with the most similar added line of the same
 * change, in order, and marks the span they disagree on. Lines that share
 * too little stay whole: marking most of a line says nothing.
 */
function markReplacements(rows: readonly DiffRow[], body: readonly string[]): readonly DiffRow[] {
  const marked = [...rows];
  let index = 0;

  while (index < rows.length) {
    let removedEnd = index;

    while (rows[removedEnd]?.kind === "removed") removedEnd += 1;
    let addedEnd = removedEnd;

    while (rows[addedEnd]?.kind === "added") addedEnd += 1;
    let paired = removedEnd - 1;

    for (let removed = index; removed < removedEnd; removed += 1) {
      const before = body[removed]?.slice(1) ?? "";
      let best:
        | { readonly added: number; readonly span: ReturnType<typeof changedSpan> }
        | undefined;

      for (let added = paired + 1; added < addedEnd; added += 1) {
        const after = body[added]?.slice(1) ?? "";
        const span = changedSpan(before, after);
        const enough = Math.max(4, 0.6 * Math.max(before.trim().length, after.trim().length));

        if (span.shared >= enough && span.shared > (best?.span.shared ?? 0)) best = { added, span };
      }

      const removedRow = rows[removed];
      const addedRow = best === undefined ? undefined : rows[best.added];

      if (best === undefined || removedRow === undefined || addedRow === undefined) continue;
      paired = best.added;
      marked[removed] = {
        ...removedRow,
        mark: { start: best.span.start, end: best.span.beforeEnd, added: false },
      };
      marked[best.added] = {
        ...addedRow,
        mark: { start: best.span.start, end: best.span.afterEnd, added: true },
      };
    }

    index = Math.max(addedEnd, index + 1);
  }

  return marked;
}

const SIGN: Record<RowKind, string> = { context: " ", added: "+", removed: "−" };

/** A unified patch against the pinned revision. `path` is relative to `packages/`. */
export function Diff(input: { readonly patch: Patch }) {
  const { path } = input.patch;
  const hunks = useMemo(() => parseHunks(input.patch), [input.patch]);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  const added = rows.filter((row) => row.kind === "added").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  const digits = String(
    Math.max(...rows.map((row) => Math.max(row.before ?? 0, row.after ?? 0))),
  ).length;
  const first = hunks[0]?.oldStart ?? 1;

  return (
    <Frame
      label={`Proposed change to ${path}`}
      title={<span {...props(styles.path)}>{path.replace(/^core\/src\//u, "")}</span>}
      meta={
        <>
          {added > 0 && <span {...props([intent.success, styles.added])}>+{added}</span>}
          {removed > 0 && <span {...props([intent.danger, styles.removed])}>−{removed}</span>}
          <SourceLink path={path} line={first} />
        </>
      }
    >
      {hunks.map((hunk, hunkIndex) => (
        <Fragment key={hunk.oldStart}>
          {hunkIndex > 0 && (
            <span {...props(styles.row, styles.gap)}>
              <span {...props(styles.gutter, styles.gutterOld, styles.gutterWidth(digits, 12))} />
              <span {...props(styles.gutter, styles.gutterWidth(digits, 24))} />
              <span {...props(styles.sign)}>⋯</span>
              <CodeText line={tokenize(hunk.context.trim())[0] ?? []} />
            </span>
          )}
          {hunk.rows.map((row, index) => (
            <Fragment key={index}>
              {"\n"}
              <span
                {...props(
                  styles.row,
                  row.kind === "added" && [intent.success, styles.addedRow],
                  row.kind === "removed" && [intent.danger, styles.removedRow],
                )}
              >
                <span {...props(styles.gutter, styles.gutterOld, styles.gutterWidth(digits, 12))}>
                  {row.before}
                </span>
                <span {...props(styles.gutter, styles.gutterWidth(digits, 24))}>{row.after}</span>
                <span
                  {...props(
                    styles.sign,
                    row.kind === "added" && [intent.success, styles.added],
                    row.kind === "removed" && [intent.danger, styles.removed],
                  )}
                >
                  {SIGN[row.kind]}
                </span>
                <CodeText line={row.line} mark={row.mark} />
              </span>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </Frame>
  );
}
