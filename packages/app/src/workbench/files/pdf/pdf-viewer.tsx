import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { createPdfPages } from "./pdf-pages.ts";
import type { PageSize, PdfFile } from "./pdfjs.ts";

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
    position: "relative",
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
  failure: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: space.s1,
    padding: space.s4,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    textAlign: "center",
    overflowWrap: "anywhere",
    backgroundColor: role.bgBase,
  },
  failureTitle: { color: role.contentPrimary, fontWeight: type.weightMedium },
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
  const [sizes, setSizes] = useState<ReadonlyMap<number, PageSize>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<number, string>>(new Map());

  const [attach] = useState(() =>
    createPdfPages(input.file, {
      onPage: setCurrent,
      onSize: (page, size) =>
        setSizes((known) => {
          const previous = known.get(page);

          return previous?.width === size.width && previous.height === size.height
            ? known
            : new Map(known).set(page, size);
        }),
      onFailure: (page, message) =>
        setFailures((known) => {
          if (known.get(page) === message) return known;
          const next = new Map(known);

          if (message === undefined) next.delete(page);
          else next.set(page, message);

          return next;
        }),
    }),
  );

  const [zoom, setZoom] = useState(1);

  const pages = Array.from(
    { length: input.file.document.numPages },
    (_, index) => sizes.get(index + 1) ?? input.file.firstPage,
  );

  const widest = pages.reduce((width, page) => Math.max(width, page.width), 0);

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
          {pages.map((page, index) => {
            const failure = failures.get(index + 1);

            return (
              <div
                key={index}
                role="img"
                aria-label={
                  failure === undefined ? `Page ${index + 1}` : `Page ${index + 1}: ${failure}`
                }
                {...props(
                  styles.page(`${(page.width / widest) * 100}%`, `${page.width} / ${page.height}`),
                )}
              >
                {failure !== undefined && (
                  <div {...props(styles.failure)}>
                    <span {...props(styles.failureTitle)}>This page could not be drawn.</span>
                    <span>{failure}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div {...props(styles.status)}>
        <span {...props(styles.position)}>
          Page {current} of {pages.length}
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
