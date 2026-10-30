import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { createPdfPages } from "./pdf-pages.ts";
import type { PdfFile } from "./pdfjs.ts";

const MIN_ZOOM = 0.5;

const MAX_ZOOM = 4;

const ZOOM_STEP = 0.25;

const styles = create({
  viewer: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  viewport: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: space.s4,
    backgroundColor: role.bgMuted,
  },
  column: (width: string) => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    width,
    marginInline: "auto",
  }),
  page: (width: string, aspectRatio: string) => ({
    flexShrink: 0,
    width,
    aspectRatio,
    backgroundColor: role.bgBase,
    boxShadow: shadow.shadowSm,
  }),
  status: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    minHeight: control.heightMd,
    paddingInline: space.s2_5,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    fontVariantNumeric: "tabular-nums",
    backgroundColor: role.bgBase,
  },
  position: { flex: 1, minWidth: 0 },
  zoom: { minWidth: space.s8, textAlign: "center" },
});

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function shortcutZoom(event: KeyboardEvent, zoom: number): number | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;

  if (event.key === "=" || event.key === "+") return clampZoom(zoom + ZOOM_STEP);

  if (event.key === "-") return clampZoom(zoom - ZOOM_STEP);

  return event.key === "0" ? 1 : undefined;
}

export function PdfViewer(input: { readonly file: PdfFile; readonly label: string }): ReactElement {
  const [current, setCurrent] = useState(1);
  const [attach] = useState(() => createPdfPages(input.file.document, setCurrent));
  const [zoom, setZoom] = useState(1);
  const widest = input.file.pages.reduce((width, page) => Math.max(width, page.width), 0);

  return (
    <div
      {...props(styles.viewer)}
      onKeyDown={(event) => {
        const next = shortcutZoom(event, zoom);

        if (next === undefined) return;
        event.preventDefault();
        setZoom(next);
      }}
    >
      <div
        ref={attach}
        role="region"
        aria-label={input.label}
        tabIndex={0}
        data-nyte-scrollport
        {...props(styles.viewport, focus.ringInset)}
      >
        <div {...props(styles.column(`${zoom * 100}%`))}>
          {input.file.pages.map((page) => (
            <div
              key={page.number}
              role="img"
              aria-label={`Page ${page.number}`}
              {...props(
                styles.page(`${(page.width / widest) * 100}%`, `${page.width} / ${page.height}`),
              )}
            />
          ))}
        </div>
      </div>
      <div {...props(styles.status)}>
        <span {...props(styles.position)}>
          Page {current} of {input.file.pages.length}
        </span>
        <Button
          iconOnly
          size="sm"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))}
        >
          −
        </Button>
        <span {...props(styles.zoom)}>{Math.round(zoom * 100)}%</span>
        <Button
          iconOnly
          size="sm"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))}
        >
          +
        </Button>
      </div>
    </div>
  );
}
