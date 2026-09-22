import { props } from "@stylexjs/stylex";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { gridOverlay } from "./grid-overlay.stylex";

export type GridMetrics = { columns: boolean; rows: boolean; revision: string };

type GuideBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: "row" | "text" | "surface";
  popup: boolean;
};

type GuideColumn = { name: string; left: number; top: number; height: number; popup: boolean };

const popupSelector =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="tooltip"]';

const rowSelector =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

export function GridOverlay({ columns: showColumns, rows, revision }: GridMetrics) {
  const ref = useRef<HTMLDivElement>(null);

  const [geometry, setGeometry] = useState<{
    boxes: GuideBox[];
    columns: GuideColumn[];
    dpr: number;
  }>({ boxes: [], columns: [], dpr: 1 });

  useLayoutEffect(() => {
    const overlay = ref.current;
    const shell = document.getElementById("lab-shell");

    if ((!rows && !showColumns) || overlay === null || shell === null) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const bounds = shell.getBoundingClientRect();
      const boxes: GuideBox[] = [];
      const columns: GuideColumn[] = [];

      const appendBox = (
        element: Element,
        kind: GuideBox["kind"],
        clip = bounds,
        popup = false,
      ) => {
        const rect = element.getBoundingClientRect();
        const scroller = element.closest("[data-grid-scroll]")?.getBoundingClientRect() ?? clip;
        const left = Math.max(rect.left, clip.left, scroller.left);
        const top = Math.max(rect.top, clip.top, scroller.top);
        const right = Math.min(rect.right, clip.right, scroller.right);
        const bottom = Math.min(rect.bottom, clip.bottom, scroller.bottom);

        if (right > left && bottom > top)
          boxes.push({ left, top, width: right - left, height: bottom - top, kind, popup });
      };

      shell
        .querySelectorAll("[data-grid-row], [data-grid-text]")
        .forEach((element) =>
          appendBox(element, element.hasAttribute("data-grid-text") ? "text" : "row"),
        );
      const seen = new Set<string>();
      shell.querySelectorAll<HTMLElement>("[data-grid-column]").forEach((element) => {
        const name = element.dataset.gridColumn;
        const rect = element.getBoundingClientRect();

        if (name === undefined || rect.width === 0 || rect.height === 0 || seen.has(name)) return;
        seen.add(name);
        columns.push({
          name,
          left: rect.left,
          top: bounds.top,
          height: bounds.height,
          popup: false,
        });
        columns.push({
          name: `${name}.end`,
          left: rect.right,
          top: bounds.top,
          height: bounds.height,
          popup: false,
        });
        const glyph = element.querySelector("svg")?.getBoundingClientRect();

        if (glyph !== undefined) {
          columns.push({
            name: `${name}.glyph`,
            left: glyph.left,
            top: bounds.top,
            height: bounds.height,
            popup: false,
          });
          columns.push({
            name: `${name}.glyph.end`,
            left: glyph.right,
            top: bounds.top,
            height: bounds.height,
            popup: false,
          });
        }
      });
      document.querySelectorAll(popupSelector).forEach((popup, index) => {
        const rect = popup.getBoundingClientRect();
        const style = getComputedStyle(popup);

        if (
          rect.width === 0 ||
          rect.height === 0 ||
          style.visibility === "hidden" ||
          style.display === "none"
        )
          return;

        const name =
          popup.getAttribute("aria-label") ?? popup.getAttribute("role") ?? String(index);

        appendBox(popup, "surface", rect, true);
        popup.querySelectorAll(rowSelector).forEach((row) => appendBox(row, "row", rect, true));
        const firstRow = popup.querySelector(rowSelector);

        const slots =
          firstRow === null ? popup.querySelectorAll("h2, p, input, button") : firstRow.children;

        Array.from(slots).forEach((slot, slotIndex) => {
          const box = slot.getBoundingClientRect();

          if (box.width === 0 || box.height === 0) return;
          appendBox(slot, "text", rect, true);
          columns.push({
            name: `${name}.${index}.${slotIndex}`,
            left: box.left,
            top: rect.top,
            height: rect.height,
            popup: true,
          });
          columns.push({
            name: `${name}.${index}.${slotIndex}.end`,
            left: box.right,
            top: rect.top,
            height: rect.height,
            popup: true,
          });
        });
      });
      setGeometry({ boxes, columns, dpr: window.devicePixelRatio });

      if (
        document
          .getAnimations()
          .some(
            (animation) =>
              animation.playState === "running" &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
      )
        frame = requestAnimationFrame(measure);
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    const resize = new ResizeObserver(schedule);

    const observe = () => {
      resize.disconnect();
      resize.observe(shell);
      document
        .querySelectorAll(
          `[data-grid-row], [data-grid-text], [data-grid-column], ${popupSelector}, ${rowSelector}`,
        )
        .forEach((element) => resize.observe(element));
    };

    const mutation = new MutationObserver((records) => {
      if (
        records.every((record) => {
          const target =
            record.target instanceof Element ? record.target : record.target.parentElement;

          return target?.closest("[data-grid-overlay]") != null;
        })
      )
        return;
      observe();
      schedule();
    });

    observe();
    mutation.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "style",
        "class",
        "hidden",
        "data-state",
        "data-open",
        "data-starting-style",
        "data-ending-style",
      ],
    });
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("animationstart", schedule, true);
    document.addEventListener("transitionrun", schedule, true);
    window.addEventListener("resize", schedule);
    measure();

    return () => {
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("animationstart", schedule, true);
      document.removeEventListener("transitionrun", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [rows, showColumns, revision]);

  return createPortal(
    <>
      {[false, true].map((popup) => (
        <div
          key={String(popup)}
          ref={popup ? ref : undefined}
          data-grid-overlay={popup ? "popup" : "base"}
          aria-hidden="true"
          {...props(
            gridOverlay.root,
            !popup && gridOverlay.base,
            gridOverlay.hairline(1 / geometry.dpr),
          )}
        >
          {showColumns &&
            geometry.columns
              .filter((column) => column.popup === popup)
              .map((column) => (
                <span
                  key={column.name}
                  data-grid-line={column.name}
                  {...props(gridOverlay.column(column.left, column.top, column.height))}
                />
              ))}
          {rows &&
            geometry.boxes
              .filter((box) => box.popup === popup)
              .map((box, index) => (
                <span
                  key={index}
                  data-grid-box={box.kind}
                  {...props(
                    gridOverlay.box(box.left, box.top, box.width, box.height),
                    box.kind === "text" && gridOverlay.text,
                    box.kind === "surface" && gridOverlay.surface,
                  )}
                />
              ))}
        </div>
      ))}
    </>,
    document.body,
  );
}
