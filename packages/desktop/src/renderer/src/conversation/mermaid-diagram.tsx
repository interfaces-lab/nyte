import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { focus } from "../components/ui.tsx";
import { keys } from "../query-keys.ts";
import { t } from "../theme/vars.stylex.ts";
import { CodeBlock } from "./code-block.tsx";
import type { DiagramResult } from "./mermaid-render.ts";

const styles = stylex.create({
  figure: {
    boxSizing: "border-box",
    width: "100%",
    marginBlock: 10,
    marginInline: 0,
    overflow: "hidden",
    borderRadius: t.radiusLg,
    backgroundColor: t.conversationTechnicalBg,
    boxShadow: `inset 0 0 0 1px ${t.conversationTechnicalRing}`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    minHeight: 30,
    paddingInline: 8,
  },
  toggle: {
    minHeight: 24,
    paddingInline: 4,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: {
      default: t.textTertiary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.textSecondary },
    },
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    cursor: "pointer",
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
    color: t.textTertiary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  diagram: {
    display: "flex",
    justifyContent: "center",
    width: "max-content",
    minWidth: "100%",
    color: t.textPrimary,
    lineHeight: 0,
  },
});

type DiagramState = DiagramResult | { readonly kind: "pending" };

function isDiagramResult(value: unknown): value is DiagramResult {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "source") return true;
  return value.kind === "diagram" && "svg" in value && typeof value.svg === "string";
}

function isRenderResponse(
  value: unknown,
): value is { readonly id: string; readonly result: DiagramResult } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "result" in value &&
    isDiagramResult(value.result)
  );
}

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
      if (isRenderResponse(event.data)) settle(event.data.result);
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
    <figure aria-label="Mermaid diagram" {...stylex.props(styles.figure)}>
      <figcaption {...stylex.props(styles.toolbar)}>
        <button
          type="button"
          aria-expanded={sourceVisible}
          {...stylex.props(styles.toggle, focus.ring)}
          onClick={() => setSourceVisible((visible) => !visible)}
        >
          {sourceVisible ? "Show diagram" : "Show source"}
        </button>
      </figcaption>
      {sourceVisible ? (
        <CodeBlock code={source} lang="mermaid" />
      ) : (
        <div data-nyte-scrollport {...stylex.props(styles.viewport)}>
          {rendered.kind === "pending" ? (
            <div role="status" {...stylex.props(styles.pending)}>
              Rendering diagram…
            </div>
          ) : (
            <div
              {...stylex.props(styles.diagram)}
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
          )}
        </div>
      )}
    </figure>
  );
}
