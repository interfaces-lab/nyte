/**
 * A dialog as five pieces rather than one component with a long prop list.
 * The parent owns `open`; this file owns presence, so the panel survives long
 * enough to animate out.
 *
 * It renders through a portal, defaulting to `document.body`. A dialog placed
 * inline would inherit whatever stacking context, overflow or transform its
 * ancestors happen to have, and the layer scale only means something when
 * nothing in between can trap it.
 *
 * `container` overrides the target for the case where the modal's world is
 * smaller than the document. In an app the window is the viewport and the
 * default is right; in a viewer that frames a mock window, the dialog belongs
 * to the frame, and a scrim that spills past it reads as a bug.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { props } from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { dialog } from "./dialog.stylex";
import { surface } from "./surface.stylex";
import { elevation } from "../tokens/layer.stylex";
import { text } from "../tokens/type.stylex";

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DialogIds = createContext<{ titleId: string; bodyId: string } | null>(null);

type DialogProps = {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /* Defaults to `document.body`. Must establish a containing block if set. */
  container?: Element | null;
};

export function Dialog({ open, onDismiss, children, container }: DialogProps) {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  /* Adjusted during render rather than in an effect: the panel has to exist
   * in the same commit that `open` turns true, or the focus effect below runs
   * a commit early and finds nothing to focus. */
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open);
  }

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement ? active : null;
    return () => restoreRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    /* The confirming action if it is safe, otherwise the way out, and never
     * the destructive button: a stray Return must not delete anything. The
     * panel is the fallback, so a dialog with no buttons still announces its
     * title and body and still answers Escape. */
    const preferred =
      panel.querySelector('[data-variant="primary"]') ??
      panel.querySelector('[data-variant="secondary"]');
    const target = preferred instanceof HTMLElement ? preferred : panel;
    target.focus();
  }, [open]);

  if (!open && !closing) return null;

  return createPortal(
    <DialogIds.Provider value={{ titleId, bodyId }}>
      <div
        {...props(elevation.scrim, dialog.scrim, closing && dialog.scrimExiting)}
        onClick={onDismiss}
      />
      <div {...props(dialog.positioner)}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          {...props(
            surface.floating.dialog,
            text.root,
            dialog.panel,
            closing && dialog.panelExiting,
          )}
          onAnimationEnd={(event) => {
            if (closing && event.target === event.currentTarget) setClosing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onDismiss();
              return;
            }
            if (event.key !== "Tab") return;
            const panel = panelRef.current;
            if (!panel) return;
            /* Tab wraps inside the panel. Without this the next Tab lands on
             * the shell behind the scrim, where nothing is reachable. */
            const stops = Array.from(panel.querySelectorAll(focusable)).filter(
              (node) => node instanceof HTMLElement,
            );
            const first = stops[0];
            const last = stops[stops.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
              return;
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          {children}
        </div>
      </div>
    </DialogIds.Provider>,
    container ?? document.body,
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  const ids = useContext(DialogIds);
  return (
    <h2 data-grid-text="" id={ids?.titleId} {...props(text.title, dialog.title)}>
      {children}
    </h2>
  );
}

export function DialogBody({ children }: { children: ReactNode }) {
  const ids = useContext(DialogIds);
  return (
    <div data-grid-text="" id={ids?.bodyId} {...props(text.body, dialog.body)}>
      {children}
    </div>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div data-grid-row="dialog-actions" {...props(dialog.actions)}>
      {children}
    </div>
  );
}

type ButtonProps = {
  /* Secondary by default. A button only becomes the confirming action or the
   * dangerous one by saying so, which keeps a row of plain buttons honest. */
  variant?: "primary" | "secondary" | "destructive";
  onClick: () => void;
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
};

/**
 * The variant is on the element as a data attribute because the root reads it
 * back from the DOM to choose initial focus. A registry through context would
 * have to agree with render order to say which button is last; the DOM knows
 * already.
 */
export function Button({
  variant = "secondary",
  onClick,
  children,
  leading,
  trailing,
}: ButtonProps) {
  const tone =
    variant === "primary"
      ? dialog.primary
      : variant === "destructive"
        ? dialog.destructive
        : dialog.secondary;

  return (
    <button
      type="button"
      data-variant={variant}
      onClick={onClick}
      {...props(text.strong, dialog.button, dialog.buttonFocus, tone)}
    >
      {leading ? <span {...props(dialog.slot)}>{leading}</span> : null}
      <span {...props(dialog.label)}>{children}</span>
      {trailing ? <span {...props(dialog.slot, dialog.slotTrailing)}>{trailing}</span> : null}
    </button>
  );
}
