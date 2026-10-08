import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { Button } from "@nyte-ai/ui/button";
import { keys } from "../query-keys.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { CodeBlock } from "./code-block.tsx";
import type { DiagramResult } from "./mermaid-render.ts";

const styles = create({
  figure: {
    boxSizing: "border-box",
    width: "100%",
    marginBlock: 10,
    marginInline: 0,
    overflow: "clip",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    paddingInline: 8,
  },
  viewport: {
    boxSizing: "border-box",
    width: "100%",
    maxHeight: 420,
    padding: 12,
    overflow: "auto",
  },
  pending: {
    display: "flex",
    alignItems: "center",
    minHeight: 96,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  diagram: {
    display: "flex",
    justifyContent: "center",
    width: "max-content",
    minWidth: "100%",
    color: role.contentPrimary,
    lineHeight: 0,
  },
});

type DiagramState = DiagramResult | { readonly kind: "pending" };

const renderResponse = Type.Object({
  id: Type.String(),
  result: Type.Union([
    Type.Object({ kind: Type.Literal("diagram"), svg: Type.String() }),
    Type.Object({ kind: Type.Literal("source") }),
  ]),
});

/**
 * Render one diagram in a dedicated worker. The protocol's `id` field is moot
 * when the worker serves a single request, but the request shape still
 * requires it. A worker failure resolves as `source` — the fence fallback — so
 * the query has no error state. A streamed fence changes source with every
 * delta, and a reader can leave before a render lands; the signal ends the
 * worker for a result nothing will show.
 */
export function renderMermaid(source: string, signal: AbortSignal): Promise<DiagramResult> {
  if (signal.aborted) return Promise.resolve({ kind: "source" });

  return new Promise((resolve) => {
    const worker = new Worker(new URL("./mermaid-worker.ts", import.meta.url), { type: "module" });
    let finished = false;

    const settle = (result: DiagramResult): void => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(result);
    };

    const cancel = (): void => settle({ kind: "source" });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (Value.Check(renderResponse, event.data)) settle(event.data.result);
    });
    worker.addEventListener("error", cancel, { once: true });
    worker.addEventListener("messageerror", cancel, { once: true });
    signal.addEventListener("abort", cancel, { once: true });

    try {
      worker.postMessage({ id: "render", source });
    } catch {
      cancel();
    }
  });
}

/** A Mermaid fence is a diagram first, with its source available on demand. */
export function MermaidDiagram({ source }: { readonly source: string }): ReactElement {
  const render = useQuery({
    queryKey: keys.mermaid(source),
    queryFn: ({ signal }) => renderMermaid(source, signal),
    // Same source always renders the same svg, so it never refetches while
    // mounted. The key holds the whole source and the result holds the svg, and
    // a streamed fence leaves one abandoned key per delta, so the entry goes
    // when its last observer does: the signal ends the worker and the cache
    // drops the key together.
    staleTime: Infinity,
    gcTime: 0,
  });

  const [sourceVisible, setSourceVisible] = useState(false);
  const rendered: DiagramState = render.data ?? { kind: "pending" };

  if (rendered.kind === "source") return <CodeBlock code={source} lang="mermaid" />;

  return (
    <figure aria-label="Mermaid diagram" {...props(styles.figure)}>
      <figcaption {...props(styles.toolbar)}>
        <Button
          size="sm"
          aria-expanded={sourceVisible}
          onClick={() => setSourceVisible((visible) => !visible)}
        >
          {sourceVisible ? "Show diagram" : "Show source"}
        </Button>
      </figcaption>
      {sourceVisible ? (
        <CodeBlock code={source} lang="mermaid" />
      ) : (
        <div data-nyte-scrollport {...props(styles.viewport)}>
          {rendered.kind === "pending" ? (
            <div role="status" {...props(styles.pending)}>
              Rendering diagram…
            </div>
          ) : (
            <div
              {...props(surfaceTheme.blue, styles.diagram)}
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
          )}
        </div>
      )}
    </figure>
  );
}
