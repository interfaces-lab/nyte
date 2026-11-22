import { props } from "@stylexjs/stylex";
import { spanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardPage, PageState, Span } from "@nyte-ai/plugin/design/board-protocol";
import { toast } from "@nyte-ai/ui/toast";
import type { BrowserBridge, BrowserSurfaceState } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { connected } from "../data/connection.ts";
import { workspacePath } from "../data/workspaces.ts";
import { parseWebUrl } from "../browser/browser-address.ts";
import { focusGuest, guestGeneration, placeGuest, sizeGuest } from "../browser/browser-guests.tsx";
import type { GuestRect, GuestSlot } from "../browser/browser-guests.tsx";
import { addPickToChat } from "../browser/browser-pick.ts";
import {
  applyBrowserEvent,
  claimBrowserSurface,
  forgetBrowserSurface,
  onBrowserBoard,
  onBrowserPick,
  watchBrowserSurface,
} from "../browser/browser-surfaces.ts";
import type { BrowserBoardEvent } from "../browser/browser-surfaces.ts";
import { studioStyles } from "./studio.stylex.ts";

const MAX_GUESTS = 5;

const MAX_VIEWPORT = 10_000;

const OPEN_INTERVAL_MS = 1000;

const GRACE_MS = 3000;

const HANDOFF_MS = 1000;

export type BrowserOwner = NonNullable<Parameters<BrowserBridge["open"]>[0]["owner"]>;

export interface ActivePage {
  readonly surface: string;
  readonly key: Span;
  readonly entered: boolean;
}

interface Guest {
  readonly surface: string;
  readonly stop: () => void;
  opened: boolean;
  loaded: boolean;
  design: boolean;
  entered: boolean;
  url: string;
}

type Showing =
  | { readonly kind: "still" }
  | { readonly kind: "revealing" }
  | { readonly kind: "live" }
  | { readonly kind: "settling"; readonly after: number };

const STILL: Showing = { kind: "still" };

const LIVE: Showing = { kind: "live" };

interface Frame {
  key: string;
  span: Span;
  readonly url: string;
  box: BoardPage;
  state: PageState;
  live: number;
  still: HTMLImageElement | undefined;
  asked: number;
  drawn: number;
  showing: Showing;
  guest: Guest | undefined;
  gone: ReturnType<typeof setTimeout> | undefined;
}

export interface BoardPages {
  ready(): void;
  read(pages: readonly BoardPage[]): void;
  measure(): void;
  focus(surface: string): void;
  close(): void;
}

export function boardPages(input: {
  readonly browser: BrowserBridge;
  readonly owner: BrowserOwner;
  readonly addresses: () => ReadonlyMap<string, string>;
  readonly frame: () => HTMLIFrameElement | null;
  readonly stills: () => HTMLElement | null;
  readonly send: (message: AppMessage) => void;
  readonly onActive: (page: ActivePage | null) => void;
}): BoardPages {
  const browser = input.browser;
  let frames: readonly Frame[] = [];
  let gone: readonly Frame[] = [];
  let area: GuestRect | undefined;
  let clock = 0;
  let opened = Number.NEGATIVE_INFINITY;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let active: ActivePage | null = null;
  let wanted: string | undefined;
  let trusted = false;

  const showError = (cause: unknown): void => {
    toast.add({ type: "error", title: errorMessage(cause) });
  };

  const holding = (guest: Guest): Frame | undefined =>
    [...frames, ...gone].find((frame) => frame.guest === guest);

  const capture = (frame: Frame, guest: Guest): void => {
    frame.asked += 1;
    const sequence = frame.asked;

    void browser.captureFrame({ surface: guest.surface }).then(
      (taken) => {
        const layer = input.stills();

        if (
          taken === undefined ||
          layer === null ||
          frame.guest !== guest ||
          sequence <= frame.drawn ||
          taken.generation !== guestGeneration(guest.surface) ||
          taken.url !== guest.url
        ) {
          return;
        }
        frame.drawn = sequence;
        const still = frame.still ?? createStill(layer);
        frame.still = still;
        still.src = taken.src;
        drawStill(frame);
        void still.decode().then(
          () => stilled(frame, sequence),
          () => undefined,
        );
      },
      () => undefined,
    );
  };

  const rest = (frame: Frame): void => {
    frame.showing = STILL;
    place();
  };

  const stilled = (frame: Frame, sequence: number): void => {
    const showing = frame.showing;

    if (showing.kind !== "settling" || sequence <= showing.after || frame.drawn !== sequence) {
      return;
    }
    rest(frame);
  };

  const reveal = (frame: Frame): void => {
    const revealing: Showing = { kind: "revealing" };
    frame.showing = revealing;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (frame.showing !== revealing) return;
        frame.showing = LIVE;
        drawStill(frame);
      }),
    );
  };

  const designOff = async (guest: Guest): Promise<void> => {
    guest.design = false;
    await browser.design({ surface: guest.surface, change: { kind: "off" } });
  };

  const observe = (guest: Guest, state: BrowserSurfaceState): void => {
    const loaded = state.url !== "" && !state.loading && state.error === undefined;
    const frame = holding(guest);
    guest.design = state.design.on;
    guest.url = state.url;

    if (loaded && !guest.loaded && frame !== undefined) capture(frame, guest);
    guest.loaded = loaded;
  };

  const handBack = (surface: string, event: BrowserBoardEvent): void => {
    const frame = frames.find((found) => found.guest?.surface === surface);

    if (frame?.state !== "entered") return;

    if (event.kind === "browser_board_leave") {
      input.send({ kind: "leave" });
      input.frame()?.focus();

      return;
    }

    const box = frame.box;
    const wheel = event.wheel;

    input.send({
      kind: "wheel",
      x: box.x + wheel.x * box.scale,
      y: box.y + wheel.y * box.scale,
      deltaX: wheel.deltaX,
      deltaY: wheel.deltaY,
      zoom: wheel.zoom,
    });
  };

  const open = (frame: Frame): Guest => {
    const surface = `design-page:${crypto.randomUUID()}`;

    const guest: Guest = {
      surface,
      stop: () => {
        for (const stop of stops) stop();
      },
      opened: false,
      loaded: false,
      design: false,
      entered: false,
      url: "",
    };

    const stops = [
      watchBrowserSurface(surface, (state) => observe(guest, state)),
      onBrowserPick(surface, (pick) => void addPickToChat(pick).catch(showError)),
      onBrowserBoard(surface, (event) => handBack(surface, event)),
    ];

    claimBrowserSurface(surface);
    void browser
      .open({ surface, url: frame.url, owner: input.owner, holder: "board" })
      .then((state) => {
        if (frame.guest !== guest) return;
        guest.opened = true;
        applyBrowserEvent({ kind: "browser_changed", surface, state });
        place();
        announce();
      }, showError);

    return guest;
  };

  const park = (guest: Guest): void => {
    placeGuest(guest.surface, null);

    if (guest.design) void designOff(guest).catch(() => undefined);

    if (!guest.entered) return;
    guest.entered = false;
    void browser.setEntered({ surface: guest.surface, entered: false }).catch(() => undefined);
  };

  const shut = (frame: Frame): void => {
    const guest = frame.guest;

    if (guest === undefined) return;
    frame.guest = undefined;
    frame.showing = STILL;
    guest.stop();
    placeGuest(guest.surface, null);
    forgetBrowserSurface(guest.surface);
    void browser.close({ surface: guest.surface }).catch(() => undefined);
  };

  const drop = (frame: Frame): void => {
    clearTimeout(frame.gone);
    shut(frame);
    frame.still?.remove();
    frame.still = undefined;
  };

  const vanish = (frame: Frame): void => {
    frame.state = "still";
    frame.showing = STILL;

    if (frame.still !== undefined) frame.still.hidden = true;

    if (frame.guest?.opened === true) park(frame.guest);

    if (frame.guest === undefined && frame.still === undefined) return;
    gone = [...gone, frame];
    frame.gone = setTimeout(() => {
      gone = gone.filter((found) => found !== frame);
      drop(frame);
    }, GRACE_MS);
  };

  const settle = (frame: Frame): void => {
    const guest = frame.guest;

    if (guest === undefined) return;

    if (frame.showing.kind !== "still") {
      const settling: Showing = { kind: "settling", after: frame.asked };
      frame.showing = settling;
      setTimeout(() => {
        if (frame.showing === settling) rest(frame);
      }, HANDOFF_MS);
    }

    const shoot = (): void => capture(frame, guest);

    if (!guest.design) {
      shoot();

      return;
    }

    void designOff(guest).then(shoot, shoot);
  };

  const drawStill = (frame: Frame): void => {
    const still = frame.still;

    if (still === undefined) return;
    still.hidden = frame.showing.kind === "live";

    if (still.hidden) return;
    const box = frame.box;
    still.style.transform = `translate(${String(box.x)}px, ${String(box.y)}px)`;
    still.style.width = `${String(box.width)}px`;
    still.style.height = `${String(box.height)}px`;
  };

  const place = (): void => {
    for (const frame of frames) {
      const guest = frame.guest;

      if (guest === undefined || !guest.opened) {
        drawStill(frame);

        continue;
      }

      const box = frame.box;
      const width = box.width / box.scale;
      const height = box.height / box.scale;
      const sized = width >= 1 && height >= 1 && width <= MAX_VIEWPORT && height <= MAX_VIEWPORT;
      const shows = frame.state !== "still" || frame.showing.kind === "settling";

      const slot =
        sized && shows && area !== undefined ? slotFor(box, area, frame.state === "entered") : null;

      placeGuest(guest.surface, slot);

      if (slot === null) frame.showing = STILL;
      else if (frame.showing.kind === "still") reveal(frame);
      drawStill(frame);

      if (slot === null && sized) sizeGuest(guest.surface, width, height);

      if (slot === null && guest.design && frame.state !== "still") {
        void designOff(guest).catch(() => undefined);
      }
      const entered = slot?.interactive === true;

      if (entered !== guest.entered) {
        guest.entered = entered;
        void browser.setEntered({ surface: guest.surface, entered }).catch(() => undefined);
      }

      if (!entered || wanted !== guest.surface) continue;
      wanted = undefined;
      focusGuest(guest.surface);
    }
  };

  const announce = (): void => {
    const frame = frames.find((found) => found.state !== "still" && found.guest?.opened === true);

    const next =
      frame?.guest === undefined
        ? null
        : { surface: frame.guest.surface, key: frame.span, entered: frame.state === "entered" };

    if (next?.surface !== wanted) wanted = undefined;

    if (
      next?.surface === active?.surface &&
      next?.entered === active?.entered &&
      (next === null || active === null || spanKey(next.key) === spanKey(active.key))
    ) {
      return;
    }
    active = next;
    input.onActive(next);
  };

  const host = (): void => {
    const frame = frames.find((found) => found.state !== "still");

    if (!trusted || frame === undefined || frame.guest !== undefined) return;
    const wait = opened + OPEN_INTERVAL_MS - Date.now();

    if (wait > 0) {
      retry ??= setTimeout(() => {
        retry = undefined;
        host();
        place();
        announce();
      }, wait);

      return;
    }

    const held = [...frames, ...gone].filter((found) => found.guest !== undefined);
    const oldest = held.toSorted((left, right) => left.live - right.live)[0];

    if (held.length >= MAX_GUESTS && oldest !== undefined) shut(oldest);
    opened = Date.now();
    frame.guest = open(frame);
  };

  const match = (pages: readonly BoardPage[]): readonly Frame[] => {
    const addresses = input.addresses();
    const seen = new Set<string>();
    let first = true;

    const listed = pages.flatMap((page) => {
      const key = spanKey(page.key);
      const url = parseWebUrl(page.url);

      if (url === undefined || seen.has(key) || addresses.get(key) !== page.url) return [];
      seen.add(key);
      const state = first ? page.state : "still";

      if (state !== "still") first = false;

      return [{ page: { ...page, state }, key, url }];
    });

    const known = [...frames, ...gone];
    const byKey = new Map(known.map((frame) => [frame.key, frame]));
    const taken = new Set<Frame>();

    const kept = listed.map((entry) => {
      const frame = byKey.get(entry.key);

      if (frame?.url !== entry.url) return undefined;
      taken.add(frame);

      return frame;
    });

    const next = listed.map((entry, index): Frame => {
      const found =
        kept[index] ?? known.find((frame) => !taken.has(frame) && frame.url === entry.url);

      const page = entry.page;
      const now = page.state === "still" ? 0 : ++clock;

      if (found === undefined) {
        return {
          key: entry.key,
          span: page.key,
          url: entry.url,
          box: page,
          state: page.state,
          live: now,
          still: undefined,
          asked: 0,
          drawn: 0,
          showing: STILL,
          guest: undefined,
          gone: undefined,
        };
      }

      taken.add(found);
      clearTimeout(found.gone);
      found.gone = undefined;

      if (page.state === "still" && found.state !== "still") settle(found);
      found.key = entry.key;
      found.span = page.key;
      found.box = page;
      found.state = page.state;
      found.live = Math.max(found.live, now);

      if (page.state !== "still" && found.showing.kind === "settling") found.showing = LIVE;

      return found;
    });

    gone = gone.filter((frame) => !taken.has(frame));

    for (const frame of frames) if (!taken.has(frame)) vanish(frame);

    return next;
  };

  const read = (pages: readonly BoardPage[]): void => {
    frames = match(pages);
    host();
    place();
    announce();
  };

  void workspaceTrusted(input.owner).then(
    (answer) => {
      trusted = answer;

      if (!answer) return;
      host();
      place();
      announce();
    },
    () => undefined,
  );

  return {
    ready() {
      read([]);
    },
    read,
    measure() {
      const box = input.frame()?.getBoundingClientRect();

      area =
        box === undefined
          ? undefined
          : { x: box.left, y: box.top, width: box.width, height: box.height };
      place();
    },
    focus(surface) {
      wanted = surface;
      place();
    },
    close() {
      clearTimeout(retry);

      for (const frame of [...frames, ...gone]) drop(frame);
      frames = [];
      gone = [];
      announce();
    },
  };
}

async function workspaceTrusted(owner: BrowserOwner): Promise<boolean> {
  if (owner.kind === "home") return false;
  const path = owner.path;
  const workspaces = await (await connected()).workspaces.list();

  return workspaces.some(
    (workspace) => workspace.trusted === true && workspacePath(workspace) === path,
  );
}

function createStill(layer: HTMLElement): HTMLImageElement {
  const still = document.createElement("img");
  still.alt = "";
  still.draggable = false;
  still.hidden = true;
  still.className = props(studioStyles.still).className ?? "";
  layer.append(still);

  return still;
}

function slotFor(box: BoardPage, area: GuestRect, interactive: boolean): GuestSlot | null {
  const rect = { x: area.x + box.x, y: area.y + box.y, width: box.width, height: box.height };

  const shows =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x < area.x + area.width &&
    rect.x + rect.width > area.x &&
    rect.y < area.y + area.height &&
    rect.y + rect.height > area.y;

  return shows ? { rect, scale: box.scale, clip: area, interactive } : null;
}
