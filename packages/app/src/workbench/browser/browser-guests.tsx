import { layer } from "@nyte-ai/ui/styles/schema.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { BROWSER_PAGE_PRESS_CHANNEL } from "../../contract/bridge.ts";
import type { BrowserBridge, BrowserGuest, HostEvent } from "../../contract/bridge.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
import { keyOwner } from "../../lib/focus-owner.ts";
import { useBrowserSurface } from "./browser-surfaces.ts";

declare global {
  interface HTMLWebViewElement {
    getWebContentsId(): number;
  }

  interface HTMLElementTagNameMap {
    webview: HTMLWebViewElement;
  }
}

export interface GuestRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GuestSlot {
  readonly rect: GuestRect;
  readonly scale: number;
  readonly clip: GuestRect | null;
  readonly interactive: boolean;
}

interface GuestPlace {
  readonly slot: GuestSlot | null;
  readonly width: number;
  readonly height: number;
}

const UNPLACED: GuestPlace = { slot: null, width: 1280, height: 800 };

const PARKED_OFFSET = -100_000;

let guests: readonly BrowserGuest[] = [];

let guestsHeard = false;

let places: ReadonlyMap<string, GuestPlace> = new Map();

const elements = new Map<string, HTMLWebViewElement>();

const attached = new WeakSet<HTMLWebViewElement>();

const focusOnAttach = new Set<string>();

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function setGuests(next: readonly BrowserGuest[]): void {
  const before = new Set(guests.map((guest) => guest.surface));
  guests = next.toSorted((left, right) => left.surface.localeCompare(right.surface));
  const hosted = new Set(guests.map((guest) => guest.surface));
  places = new Map(
    [...places].filter(
      ([surface, place]) => hosted.has(surface) || (place.slot !== null && !before.has(surface)),
    ),
  );
  notify();
}

export function applyBrowserGuests(event: Extract<HostEvent, { kind: "browser_guests" }>): void {
  guestsHeard = true;
  setGuests(event.guests);
}

export function guestGeneration(surface: string): number | undefined {
  return guests.find((guest) => guest.surface === surface)?.generation;
}

function sameRect(left: GuestRect | null, right: GuestRect | null): boolean {
  if (left === null || right === null) return left === right;

  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameSlot(left: GuestSlot | null, right: GuestSlot | null): boolean {
  if (left === null || right === null) return left === right;

  return (
    left.scale === right.scale &&
    left.interactive === right.interactive &&
    sameRect(left.rect, right.rect) &&
    sameRect(left.clip, right.clip)
  );
}

function releaseKeyboard(surface: string): void {
  focusOnAttach.delete(surface);
  const element = elements.get(surface);

  if (element !== undefined && document.activeElement === element) element.blur();
}

export function placeGuest(surface: string, slot: GuestSlot | null): void {
  const previous = places.get(surface) ?? UNPLACED;

  if (sameSlot(previous.slot, slot)) return;

  const next: GuestPlace =
    slot === null
      ? { ...previous, slot }
      : {
          slot,
          width: Math.round(slot.rect.width / slot.scale),
          height: Math.round(slot.rect.height / slot.scale),
        };

  places = new Map(places).set(surface, next);

  if (slot === null || !slot.interactive) releaseKeyboard(surface);

  if ((previous.slot === null) !== (slot === null))
    nyte.host.browser?.setShown({ surface, visible: slot !== null });

  notify();
}

export function sizeGuest(surface: string, width: number, height: number): void {
  const previous = places.get(surface) ?? UNPLACED;
  const next: GuestPlace = { slot: null, width: Math.round(width), height: Math.round(height) };

  if (previous.slot !== null || (previous.width === next.width && previous.height === next.height))
    return;
  places = new Map(places).set(surface, next);
  notify();
}

export function focusGuest(surface: string): void {
  if (places.get(surface)?.slot?.interactive !== true || keyOwner() !== undefined) return;
  const element = elements.get(surface);

  if (element === undefined || !attached.has(element)) {
    focusOnAttach.add(surface);

    return;
  }

  element.focus({ preventScroll: true });
}

function hostElement(surface: string, element: HTMLWebViewElement): () => void {
  elements.set(surface, element);

  return () => {
    if (elements.get(surface) === element) elements.delete(surface);
  };
}

function markAttached(surface: string, element: HTMLWebViewElement): void {
  attached.add(element);

  if (focusOnAttach.delete(surface)) focusGuest(surface);
}

let pressed = false;

let dragging = false;

function readGesture(): boolean {
  return pressed || dragging;
}

function subscribeGesture(listener: () => void): () => void {
  const update = (next: { readonly pressed: boolean; readonly dragging: boolean }): void => {
    pressed = next.pressed;
    dragging = next.dragging;
    listener();
  };

  const press = (event: PointerEvent): void => {
    if (event.isTrusted && event.button === 0) update({ pressed: true, dragging: false });
  };

  const release = (): void => update({ pressed: false, dragging });
  const drag = (): void => update({ pressed, dragging: true });
  const drop = (): void => update({ pressed, dragging: false });
  const reset = (): void => update({ pressed: false, dragging: false });

  window.addEventListener("pointerdown", press, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("dragstart", drag, true);
  window.addEventListener("dragend", drop, true);
  window.addEventListener("drop", drop, true);
  window.addEventListener("blur", reset);
  window.addEventListener("contextmenu", reset, true);

  return () => {
    window.removeEventListener("pointerdown", press, true);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("dragstart", drag, true);
    window.removeEventListener("dragend", drop, true);
    window.removeEventListener("drop", drop, true);
    window.removeEventListener("blur", reset);
    window.removeEventListener("contextmenu", reset, true);
  };
}

const styles = create({
  box: { position: "fixed", overflow: "clip", pointerEvents: "none" },
  at: (x: number, y: number) => ({
    // oxlint-disable-next-line nyte-design/logical-properties -- window coordinates from getBoundingClientRect are physical
    left: x,
    top: y,
  }),
  size: (width: number, height: number) => ({ width, height }),
  shown: { zIndex: layer.page },
  input: { pointerEvents: "auto" },
  fullscreen: { inset: 0, zIndex: layer.fullscreenPage, pointerEvents: "auto" },
  behind: { zIndex: -1 },
  parkedByOpacity: { opacity: 0 },
  frame: { position: "absolute" },
  fullDetail: { transformStyle: "preserve-3d" },
  scaled: (transform: string) => ({ transform, transformOrigin: "0 0" }),
  fill: { width: "100%", height: "100%" },
  element: { display: "flex", width: "100%", height: "100%" },
});

function scaleTransform(scale: number, fullDetail: boolean): string {
  if (!fullDetail || scale > 1) return `scale(${String(scale)})`;
  const depth = Math.sqrt(1 - scale * scale);

  return `matrix3d(${String(scale)}, 0, ${String(depth)}, 0, 0, ${String(scale)}, ${String(depth)}, 0, 0, 0, 1, 0, 0, 0, 0, 1)`;
}

function clipRect(rect: GuestRect, clip: GuestRect | null): GuestRect {
  if (clip === null) return rect;
  const x = Math.max(rect.x, clip.x);
  const y = Math.max(rect.y, clip.y);

  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.x + rect.width, clip.x + clip.width) - x),
    height: Math.max(0, Math.min(rect.y + rect.height, clip.y + clip.height) - y),
  };
}

function HostedGuest({
  browser,
  guest,
  gesture,
}: {
  readonly browser: BrowserBridge;
  readonly guest: BrowserGuest;
  readonly gesture: boolean;
}): ReactElement {
  const pageRef = useRef<HTMLDivElement>(null);
  const surface = guest.surface;

  const place = useSyncExternalStore(
    subscribe,
    () => places.get(surface) ?? UNPLACED,
    () => UNPLACED,
  );

  const fullscreen = useBrowserSurface(surface).state?.fullscreen === true;

  useMountEffect(() => {
    const page = pageRef.current;

    if (page === null) return undefined;
    const element = document.createElement("webview");
    element.setAttribute("partition", guest.partition);
    element.setAttribute("allowpopups", "");
    element.setAttribute("tabindex", "-1");
    element.setAttribute("src", "about:blank");
    element.className = props(styles.element).className ?? "";

    const ready = (): void => {
      element.removeEventListener("dom-ready", ready);
      void browser
        .attach({
          surface,
          webContentsId: element.getWebContentsId(),
          generation: guest.generation,
        })
        .catch((cause: unknown) => {
          if (elements.get(surface) === element)
            toast.add({ type: "error", title: errorMessage(cause) });
        });
      markAttached(surface, element);
    };

    const dismissPopups = (): void => {
      element.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" }),
      );
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    };

    const pagePressed = (event: Event): void => {
      if ("channel" in event && event.channel === BROWSER_PAGE_PRESS_CHANNEL) dismissPopups();
    };

    element.addEventListener("dom-ready", ready);
    element.addEventListener("focus", dismissPopups);
    element.addEventListener("ipc-message", pagePressed);
    const release = hostElement(surface, element);
    page.append(element);

    return () => {
      element.removeEventListener("dom-ready", ready);
      element.removeEventListener("focus", dismissPopups);
      element.removeEventListener("ipc-message", pagePressed);
      release();
      element.remove();
    };
  });

  const look = guestLook({ place, fullscreen, painting: guest.painting, gesture });

  return (
    <div aria-hidden={look.parked || undefined} {...props(look.box)}>
      <div {...props(look.frame)}>
        <div ref={pageRef} {...props(look.page)} />
      </div>
    </div>
  );
}

interface GuestLook {
  readonly parked: boolean;
  readonly box: StyleXStyles;
  readonly frame: StyleXStyles;
  readonly page: StyleXStyles;
}

function guestLook(input: {
  readonly place: GuestPlace;
  readonly fullscreen: boolean;
  readonly painting: boolean;
  readonly gesture: boolean;
}): GuestLook {
  const place = input.place;
  const slot = place.slot;

  if (input.fullscreen)
    return {
      parked: false,
      box: [styles.box, styles.fullscreen],
      frame: [styles.frame, styles.fill],
      page: styles.fill,
    };

  if (slot === null)
    return {
      parked: true,
      box: [
        styles.box,
        styles.behind,
        styles.size(place.width, place.height),
        input.painting
          ? [styles.at(0, 0), styles.parkedByOpacity]
          : styles.at(PARKED_OFFSET, PARKED_OFFSET),
      ],
      frame: styles.frame,
      page: styles.size(place.width, place.height),
    };

  const box = clipRect(slot.rect, slot.clip);
  const fullDetail = input.painting && slot.scale < 1;

  return {
    parked: false,
    box: [
      styles.box,
      styles.at(box.x, box.y),
      styles.size(box.width, box.height),
      styles.shown,
      slot.interactive && !input.gesture && styles.input,
    ],
    frame: [
      styles.frame,
      styles.at(slot.rect.x - box.x, slot.rect.y - box.y),
      fullDetail && styles.fullDetail,
    ],
    page: [
      styles.size(place.width, place.height),
      slot.scale !== 1 && styles.scaled(scaleTransform(slot.scale, fullDetail)),
    ],
  };
}

export function BrowserGuestHost({ browser }: { readonly browser: BrowserBridge }): ReactElement {
  const hosted = useSyncExternalStore(
    subscribe,
    () => guests,
    () => guests,
  );

  const gesture = useSyncExternalStore(subscribeGesture, readGesture, () => false);

  useMountEffect(() => {
    void browser.guests().then(
      (list) => {
        if (!guestsHeard) setGuests(list);
      },
      (cause: unknown) => toast.add({ type: "error", title: errorMessage(cause) }),
    );
  });

  return (
    <div data-nyte-browser-guests="">
      {hosted.map((guest) => (
        <HostedGuest
          key={`${guest.surface} ${String(guest.generation)}`}
          browser={browser}
          guest={guest}
          gesture={gesture}
        />
      ))}
    </div>
  );
}
