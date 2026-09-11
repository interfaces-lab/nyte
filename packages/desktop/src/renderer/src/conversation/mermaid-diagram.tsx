import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useState } from "react";
import type { ReactElement } from "react";
import { focus } from "../components/ui.tsx";
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
type RenderState = { readonly source: string; readonly result: DiagramState };

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

/** A Mermaid fence is a diagram first, with its source available on demand. */
export function MermaidDiagram({ source }: { readonly source: string }): ReactElement {
  const id = useId();
  const [renderState, setRenderState] = useState<RenderState>({
    source,
    result: { kind: "pending" },
  });
  const [sourceVisible, setSourceVisible] = useState(false);
  const rendered =
    renderState.source === source ? renderState.result : ({ kind: "pending" } as const);

  useEffect(() => {
    const worker = new Worker(new URL("./mermaid-worker.ts", import.meta.url), { type: "module" });
    const receive = (event: MessageEvent<unknown>): void => {
      if (!isRenderResponse(event.data) || event.data.id !== id) return;
      setRenderState({ source, result: event.data.result });
      worker.terminate();
    };
    const fail = (): void => {
      setRenderState({ source, result: { kind: "source" } });
      worker.terminate();
    };
    worker.addEventListener("message", receive);
    worker.addEventListener("error", fail, { once: true });
    worker.postMessage({ id, source });
    return () => worker.terminate();
  }, [id, source]);

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
