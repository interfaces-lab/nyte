import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { keys } from "../../data/query-client.ts";
import { loadDeferred } from "../../lib/deferred.tsx";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { CodeBlock } from "./code-block.tsx";
import type { DiagramResult } from "./mermaid-render.ts";

const styles = create({
  figure: {
    boxSizing: "border-box",
    width: "100%",
    marginBlock: space.s2_5,
    marginInline: 0,
    overflow: "clip",
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    paddingInline: space.s2,
  },
  viewport: {
    boxSizing: "border-box",
    width: "100%",
    maxHeight: 420,
    padding: space.s3,
    overflow: "auto",
  },
  pending: {
    display: "flex",
    alignItems: "center",
    minHeight: 96,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
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

/**
 * beautiful-mermaid's ELK layout runs only on the main thread: in a worker it takes itself for
 * ELK's own worker script. Each diagram waits for a task of its own, so a chat full of them
 * doesn't lay out in one long task.
 */
async function renderMermaid(source: string): Promise<DiagramResult> {
  const runtime = await loadDeferred("mermaid");
  await new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

  return runtime.renderDiagram(source);
}

export function MermaidDiagram({ source }: { readonly source: string }): ReactElement {
  const render = useQuery({
    queryKey: keys.mermaid(source),
    queryFn: () => renderMermaid(source),
  });

  const [sourceVisible, setSourceVisible] = useState(false);
  const rendered: DiagramState = render.data ?? { kind: "pending" };

  if (render.isError || rendered.kind === "source")
    return <CodeBlock code={source} lang="mermaid" />;

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
            <div role="status" {...props(text.sm, styles.pending)}>
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
