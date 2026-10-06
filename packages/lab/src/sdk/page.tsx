/**
 * The SDK spec as a document: doc comments read as prose, code stays beside
 * them with its line numbers in `packages/lab/sdk-spec.ts`.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { CodeBlock } from "@nyte-ai/app/conversation/code-block.tsx";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import source from "../../sdk-spec.ts?raw";
import { parseSpec, type SpecBlock, type SpecLine } from "./spec";

const BLOCKS = parseSpec(source);

const LINE_COUNT = source.split("\n").length;

type Run = {
  readonly kind: "paragraph" | "item" | "line" | "pre";
  readonly lines: SpecLine[];
};

/** Wrapped comment lines join into paragraphs; indented and aligned lines keep their shape. */
function runsOf(lines: readonly SpecLine[]): Run[] {
  const runs: Run[] = [];
  let open = false;

  for (const line of lines) {
    const { text } = line;

    if (text.trim() === "") {
      open = false;
      continue;
    }

    const last = open ? runs.at(-1) : undefined;

    if (last?.kind === "item" && /^ {2}\S/.test(text)) {
      last.lines.push(line);
      continue;
    }

    const kind = text.startsWith("- ")
      ? "item"
      : /\S {2,}\S/.test(text.trim())
        ? "pre"
        : /^\s/.test(text)
          ? "line"
          : "paragraph";

    if (last !== undefined && last.kind === kind && kind !== "item") last.lines.push(line);
    else runs.push({ kind, lines: [line] });
    open = true;
  }

  return runs;
}

function Prose({ lines }: { readonly lines: readonly SpecLine[] }): ReactElement {
  return (
    <div {...props(styles.prose)}>
      {runsOf(lines).map((run) => {
        const key = run.lines[0]?.number;

        if (run.kind === "pre") {
          return (
            <pre key={key} {...props(styles.aligned)}>
              {run.lines.map((line) => (
                <span key={line.number} id={`L${String(line.number)}`} {...props(styles.row)}>
                  {line.text.trimStart()}
                </span>
              ))}
            </pre>
          );
        }

        if (run.kind === "line") {
          return (
            <div key={key} {...props(styles.lines)}>
              {run.lines.map((line) => (
                <span key={line.number} id={`L${String(line.number)}`} {...props(styles.row)}>
                  {line.text.trim()}
                </span>
              ))}
            </div>
          );
        }

        return (
          <p key={key} {...props(styles.paragraph, run.kind === "item" && styles.item)}>
            {run.lines.map((line, index) => (
              <span key={line.number} id={`L${String(line.number)}`}>
                {index > 0 && " "}
                {index === 0 && run.kind === "item" ? line.text.slice(2) : line.text.trim()}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function rangeOf(lines: readonly SpecLine[]): string {
  const first = lines[0]?.number;
  const last = lines.at(-1)?.number;

  if (first === undefined || last === undefined) return "";

  return first === last ? `L${String(first)}` : `L${String(first)}–${String(last)}`;
}

/** "1. Usage. All consumers…" reads as the title "1. Usage" and its summary. */
function splitTitle(text: string): { readonly title: string; readonly summary: string } {
  const match = /^((?:Part [IVX]+|\d+)\. [^.]+)\.\s*(.*)$/.exec(text);

  return match?.[1] === undefined
    ? { title: text, summary: "" }
    : { title: match[1], summary: match[2] ?? "" };
}

function Block({ block }: { readonly block: SpecBlock }): ReactElement {
  switch (block.kind) {
    case "part": {
      const { title } = splitTitle(block.line.text);
      const [eyebrow, name] = title.split(". ");

      return (
        <header id={block.id} {...props(styles.part)}>
          <span id={`L${String(block.line.number)}`} {...props(styles.eyebrow)}>
            {eyebrow}
          </span>
          <h2 {...props(styles.partTitle)}>{name ?? title}</h2>
        </header>
      );
    }

    case "section": {
      const { title, summary } = splitTitle(block.line.text);

      return (
        <section id={block.id} {...props(styles.section)}>
          <h3 id={`L${String(block.line.number)}`} {...props(styles.sectionTitle)}>
            {title}
          </h3>
          {summary !== "" && <p {...props(styles.summary)}>{summary}</p>}
          {block.notes.length > 0 && <Prose lines={block.notes} />}
        </section>
      );
    }

    case "note":
      return (
        <section id={block.id} {...props(styles.block)}>
          {block.title !== undefined && (
            <h4 id={`L${String(block.title.number)}`} {...props(styles.noteTitle)}>
              {block.title.text}
            </h4>
          )}
          <Prose lines={block.lines} />
        </section>
      );
    case "entry": {
      const [name, ...others] = block.names;

      return (
        <section id={block.id} {...props(styles.block)}>
          <div {...props(styles.entryHeader)}>
            <h4 {...props(styles.entryTitle)}>{name}</h4>
            <span {...props(styles.range)}>{rangeOf([...block.doc, ...block.code])}</span>
          </div>
          {others.length > 0 && <p {...props(styles.also)}>Also declares {others.join(", ")}</p>}
          {block.doc.length > 0 && <Prose lines={block.doc} />}
          <CodeBlock code={block.code.map((line) => line.text).join("\n")} lang="typescript" />
        </section>
      );
    }
  }
}

export function SdkSpecPage(): ReactElement {
  const [intro, ...rest] = BLOCKS;

  return (
    <main {...props(styles.page)}>
      <article {...props(styles.article)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>Nyte SDK spec</h1>
          <p {...props(styles.meta)}>
            packages/lab/sdk-spec.ts · {LINE_COUNT.toLocaleString()} lines
          </p>
        </header>
        {intro?.kind === "note" ? <Prose lines={intro.lines} /> : intro && <Block block={intro} />}
        {rest.map((block) => (
          <Block key={block.id} block={block} />
        ))}
      </article>
    </main>
  );
}

const styles = create({
  page: {
    blockSize: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    userSelect: "text",
  },
  article: {
    maxInlineSize: 820,
    marginInline: "auto",
    paddingBlock: "48px 120px",
    paddingInline: 40,
  },
  header: {
    marginBlockEnd: 24,
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: "36px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
  },
  meta: {
    marginBlock: "6px 0",
    color: role.contentTertiary,
    fontSize: type.fontSm,
  },
  part: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBlockStart: 72,
    paddingBlockStart: 24,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondary,
  },
  eyebrow: {
    color: role.contentTertiary,
    fontSize: type.fontSm,
    fontWeight: 500,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  partTitle: {
    margin: 0,
    fontSize: 24,
    lineHeight: "30px",
    fontWeight: 650,
    letterSpacing: "-0.015em",
  },
  section: {
    marginBlockStart: 48,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 19,
    lineHeight: "26px",
    fontWeight: 600,
  },
  summary: {
    marginBlock: "4px 0",
    color: role.contentSecondary,
    fontSize: 15,
    lineHeight: "24px",
  },
  block: {
    marginBlockStart: 36,
  },
  noteTitle: {
    margin: "0 0 4px",
    fontSize: 16,
    lineHeight: "24px",
    fontWeight: 600,
  },
  entryHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  entryTitle: {
    margin: 0,
    fontSize: 16,
    lineHeight: "24px",
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  range: {
    flexShrink: 0,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  also: {
    marginBlock: "2px 0",
    color: role.contentTertiary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  prose: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBlock: "8px 12px",
    fontSize: 15,
    lineHeight: "24px",
    color: role.contentSecondary,
  },
  paragraph: {
    margin: 0,
    textWrap: "pretty",
  },
  item: {
    position: "relative",
    paddingInlineStart: 18,
    "::before": {
      content: '"–"',
      position: "absolute",
      insetInlineStart: 2,
      color: role.contentTertiary,
    },
  },
  lines: {
    display: "flex",
    flexDirection: "column",
    paddingInlineStart: 16,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderSecondary,
  },
  aligned: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 12,
    overflowX: "auto",
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
  },
  row: {
    display: "block",
    ":target": { backgroundColor: role.bgInteractivePrimaryTranslucent },
  },
});
