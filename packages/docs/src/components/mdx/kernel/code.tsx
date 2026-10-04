import { highlight } from "fumadocs-core/highlight";
import type { ReactNode } from "react";
import { CodeFrame } from "~/app/(site)/_layout/code-frame";
import type { Excerpt } from "./excerpts";
import type { Patch } from "./patches";
import { sourceLabel, sourceUrl } from "./source";

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
      className="font-mono text-xs"
    >
      {sourceLabel(input.path, input.line, input.end)} <span aria-hidden>↗</span>
    </a>
  );
}

async function highlightKernelCode(code: string, lang: "typescript" | "diff") {
  "use cache";

  return highlight(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    components: { pre: CodeFrame },
  });
}

async function Figure(input: {
  readonly label: string;
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly code: string;
  readonly lang: "typescript" | "diff";
  readonly line?: number;
}) {
  const code = await highlightKernelCode(input.code, input.lang);

  return (
    <figure
      aria-label={input.label}
      className="kernel-code"
      data-numbered={input.line !== undefined || undefined}
      style={{ counterReset: `kernel-line ${(input.line ?? 1) - 1}` }}
    >
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-3 text-sm text-muted-foreground">
        <span className="mr-auto">{input.title}</span>
        {input.meta}
      </figcaption>
      {code}
    </figure>
  );
}

export function Source(input: { readonly title: string; readonly excerpt: Excerpt }) {
  const { excerpt } = input;
  const last = excerpt.line + excerpt.code.split("\n").length - 1;
  return (
    <Figure
      label={`${input.title}, ${sourceLabel(excerpt.path, excerpt.line, last)}`}
      title={input.title}
      meta={<SourceLink path={excerpt.path} line={excerpt.line} end={last} />}
      code={excerpt.code}
      lang="typescript"
      line={excerpt.line}
    />
  );
}

export function Sketch(input: { readonly title: string; readonly code: string }) {
  return (
    <Figure
      label={`${input.title}, sketch`}
      title={input.title}
      meta="Sketch"
      code={input.code}
      lang="typescript"
    />
  );
}

export function Diff({ patch }: { readonly patch: Patch }) {
  const lines = patch.patch.split("\n");
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const first = Number(patch.patch.match(/^@@ -(\d+)/u)?.[1] ?? 1);
  return (
    <Figure
      label={`Proposed change to ${patch.path}`}
      title={<span className="font-mono text-xs">{patch.path.replace(/^core\/src\//u, "")}</span>}
      meta={
        <>
          {added > 0 && <span>+{added}</span>}
          {removed > 0 && <span>−{removed}</span>}
          <SourceLink path={patch.path} line={first} />
        </>
      }
      code={patch.patch}
      lang="diff"
    />
  );
}
