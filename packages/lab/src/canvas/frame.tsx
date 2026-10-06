import { create, props } from "@stylexjs/stylex";
import { useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMountEffect } from "@nyte-ai/app/use-mount-effect.ts";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Value } from "typebox/value";
import { canvasRequest } from "./api";
import { FrameMessageSchema } from "./messages";
import { CanvasSnapshotSchema, type CanvasSnapshot } from "./wire";

/** The frame's first height, before it reports its own: the SDK's default chart height. */
const PLACEHOLDER_HEIGHT = 240;

// The sandbox document sits outside StyleX: it reads only the variables the host resolves below.
const FRAME_CSS =
  ":root{color-scheme:light dark}html,body{margin:0;padding:0;background:transparent}" +
  "body{color:var(--canvas-fg);font-family:var(--canvas-font);font-size:var(--canvas-font-size);line-height:1.45;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}" +
  "*{box-sizing:border-box}#canvas-root{display:flow-root}svg{max-width:100%}svg text{font-family:inherit}" +
  "h1,h2,h3{margin:0 0 8px;font-weight:600;line-height:1.3}h1{font-size:1.3em}h2{font-size:1.15em}h3{font-size:1em}p{margin:0 0 8px}" +
  "table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--canvas-grid)}th{color:var(--canvas-muted);font-weight:500}";

export function CanvasFrame({ id }: { readonly id: string }): ReactElement {
  const query = useQuery({
    queryKey: ["canvas", "snapshot", id],
    queryFn: () => canvasRequest(CanvasSnapshotSchema, `/${id}`),
  });

  if (query.error !== null)
    return (
      <figure {...props(styles.figure)}>
        <p role="alert" {...props(styles.message)}>
          {query.error.message}
        </p>
      </figure>
    );

  if (query.data === undefined)
    return (
      <figure {...props(styles.figure)}>
        <p role="status" {...props(styles.message, styles.placeholder)}>
          Loading canvas…
        </p>
      </figure>
    );

  return <LoadedFrame key={id} snapshot={query.data} />;
}

function LoadedFrame({ snapshot }: { readonly snapshot: CanvasSnapshot }): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const [error, setError] = useState<string>();

  useMountEffect(() => {
    const element = frame.current;
    const themeProbe = probe.current;

    if (element === null || themeProbe === null) return;
    let ready = false;

    const theme = () => {
      const read = (key: string): string => {
        const node = themeProbe.querySelector(`[data-canvas="${key}"]`);

        return node === null ? "" : getComputedStyle(node).color;
      };

      const root = getComputedStyle(themeProbe);

      return {
        scheme: root.colorScheme === "" ? "normal" : root.colorScheme,
        variables: {
          "--canvas-fg": read("fg"),
          "--canvas-muted": read("muted"),
          "--canvas-subtle": read("subtle"),
          "--canvas-grid": read("grid"),
          "--canvas-border": read("border"),
          "--canvas-surface": read("surface"),
          "--canvas-font": root.fontFamily,
          "--canvas-font-size": root.fontSize,
          "--canvas-chart-1": read("chart-1"),
          "--canvas-chart-2": read("chart-2"),
          "--canvas-chart-3": read("chart-3"),
          "--canvas-chart-4": read("chart-4"),
          "--canvas-chart-5": read("chart-5"),
          "--canvas-chart-6": read("chart-6"),
        },
      };
    };

    const update = (): void => {
      if (ready) element.contentWindow?.postMessage({ kind: "canvas:mount", theme: theme() }, "*");
    };

    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== element.contentWindow || !Value.Check(FrameMessageSchema, event.data))
        return;
      const data = event.data;

      if (data.kind === "canvas:ready") {
        if (ready) return;

        ready = true;
        element.contentWindow?.postMessage(
          { kind: "canvas:mount", code: snapshot.code, theme: theme() },
          "*",
        );
      }

      if (data.kind === "canvas:height") setHeight(Math.max(1, Math.ceil(data.height)));

      if (data.kind === "canvas:error") setError(data.message);
    };

    window.addEventListener("message", receive);
    const appearance = new MutationObserver(update);
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-appearance", "data-theme"],
    });
    const preference = matchMedia("(prefers-color-scheme: dark)");
    preference.addEventListener("change", update);

    return () => {
      window.removeEventListener("message", receive);
      appearance.disconnect();
      preference.removeEventListener("change", update);
    };
  });

  const documentSource = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${location.origin} 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>${FRAME_CSS}</style></head><body><div id="canvas-root"></div><script src="${location.origin}/core/canvas/runtime.js"></script></body></html>`;

  return (
    <figure aria-label={snapshot.title} {...props(styles.figure)}>
      <figcaption {...props(styles.caption)}>{snapshot.title}</figcaption>
      <div ref={probe} aria-hidden="true" {...props(styles.probe)}>
        <span data-canvas="fg" {...props(styles.fg)} />
        <span data-canvas="muted" {...props(styles.muted)} />
        <span data-canvas="subtle" {...props(styles.subtle)} />
        <span data-canvas="grid" {...props(styles.grid)} />
        <span data-canvas="border" {...props(styles.border)} />
        <span data-canvas="surface" {...props(styles.surface)} />
        <span data-canvas="chart-1" {...props(surfaceTheme.blue, styles.series)} />
        <span data-canvas="chart-2" {...props(surfaceTheme.teal, styles.series)} />
        <span data-canvas="chart-3" {...props(surfaceTheme.purple, styles.series)} />
        <span data-canvas="chart-4" {...props(surfaceTheme.orange, styles.series)} />
        <span data-canvas="chart-5" {...props(surfaceTheme.pink, styles.series)} />
        <span data-canvas="chart-6" {...props(surfaceTheme.green, styles.series)} />
      </div>
      <div {...props(styles.body)}>
        {error !== undefined && (
          <p role="alert" {...props(styles.message)}>
            Canvas could not render: {error}
          </p>
        )}
        <iframe
          ref={frame}
          title={snapshot.title}
          sandbox="allow-scripts"
          srcDoc={documentSource}
          onLoad={() => frame.current?.contentWindow?.postMessage({ kind: "canvas:hello" }, "*")}
          {...props(
            styles.frame(height ?? PLACEHOLDER_HEIGHT),
            error !== undefined && styles.hidden,
          )}
        />
      </div>
    </figure>
  );
}

const styles = create({
  figure: {
    boxSizing: "border-box",
    width: "100%",
    margin: 0,
    overflow: "hidden",
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  caption: {
    paddingBlockStart: 12,
    paddingInline: 16,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
  },
  body: { paddingBlock: "12px 14px", paddingInline: 16 },
  message: {
    margin: 0,
    color: role.contentSecondary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: PLACEHOLDER_HEIGHT,
  },
  probe: {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
  },
  fg: { color: role.contentPrimary },
  muted: { color: role.contentSecondary },
  subtle: { color: role.contentTertiary },
  grid: { color: role.borderSecondaryTranslucent },
  border: { color: role.borderPrimary },
  surface: { color: role.bgMuted },
  series: { color: role.bgInteractiveStrong },
  // DERIVED: the height is what the sandboxed page measured, not a layout choice here.
  frame: (height: number) => ({ display: "block", width: "100%", height, borderStyle: "none" }),
  hidden: { display: "none" },
});
