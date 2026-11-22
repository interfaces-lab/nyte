import { props } from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { ReactElement, Ref } from "react";
import { readBoardMessage, textDigest } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardMessage, Span } from "@nyte-ai/plugin/design/board-protocol";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { canvasTheme } from "../canvas/canvas-theme.ts";
import { nyte } from "../contract/nyte.ts";
import { currentLights, HERE, watchLights } from "../light/light.ts";
import type { Subject } from "../light/light.ts";
import { useAppearance } from "../theme/appearance-store.ts";
import type { Appearance } from "../theme/appearance-store.ts";
import { boardPages } from "./board-pages.ts";
import type { ActivePage, BoardPages } from "./board-pages.ts";
import { buildBoard, readPageAddresses } from "./design-compile.ts";
import type { BoardLoad } from "./design-compile.ts";
import { clearDrawn, recordDrawn } from "./design-diagnostics.ts";
import { parseDesign, smallestChange } from "./design-source.ts";
import type { Change, DesignSource } from "./design-source.ts";
import { SURFACE } from "./designs.ts";
import type { DesignStore, Designs } from "./designs.ts";
import { studioStyles } from "./studio.stylex.ts";

type BoardCamera = Extract<AppMessage, { kind: "camera" }>["to"];

export interface BoardHandle {
  /** Flies the camera to a file's frames. */
  reveal(path: string): void;
  /** Fits every frame, shows the board at 100%, or frames the selection. */
  camera(to: BoardCamera): void;
  enter(page: ActivePage): void;
}

type Edited = Extract<BoardMessage, { kind: "text" } | { kind: "move" }>;

const DEFAULT_SHELL = "/canvas/index.html";

/**
 * The board: every design file drawn in a sandboxed frame of the canvas shell, which runs the designs' code so this
 * window never does. This side compiles the designs, keeps the board told about the light, and turns what the person
 * does there into the light and into edits of literal text and frame places.
 */
export function Board(input: {
  readonly store: DesignStore;
  readonly designs: Designs;
  readonly night: boolean;
  readonly following: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly workspacePath: string | undefined;
  readonly onPage: (page: ActivePage | null) => void;
  readonly handle: Ref<BoardHandle>;
}): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  const pages = useRef<BoardPages | undefined>(undefined);

  const shell = useRef<{
    ready: boolean;
    load: BoardLoad | null;
    built: number;
    addresses: ReadonlyMap<string, string>;
    accepted: ReadonlyMap<string, string>;
  }>({ ready: false, load: null, built: 0, addresses: new Map(), accepted: new Map() });

  const stills = useRef<HTMLDivElement>(null);

  const shown = useAppearance();
  const designs = input.designs;

  const send = (message: AppMessage): void => {
    if (shell.current.ready) frame.current?.contentWindow?.postMessage(message, "*");
  };

  const follows = useEffectEvent((): boolean => input.following);
  const zoomed = useEffectEvent((zoom: number) => input.onZoom(zoom));
  const paged = useEffectEvent((page: ActivePage | null) => input.onPage(page));
  const shone = useEffectEvent((subject: Subject | null) => input.store.shine(subject));
  const edited = useEffectEvent((message: Edited) => applyEdit(input.store, message));
  const lit = useEffectEvent((follow: "you" | "agents" | null) =>
    lightsMessage(input.store, follow),
  );

  const greet = useEffectEvent((): void => {
    shell.current.ready = true;
    pages.current?.ready();
    send(chromeMessage(shown));
    send({ kind: "theme", night: input.night });
    send(
      lightsMessage(
        input.store,
        input.following && input.store.lights(currentLights()).you !== null ? "you" : null,
      ),
    );

    if (shell.current.load !== null) send(shell.current.load);
  });

  useImperativeHandle(input.handle, () => ({
    reveal: (path) => send({ kind: "reveal", path }),
    camera: (to) => send({ kind: "camera", to }),
    enter: (page) => {
      pages.current?.focus(page.surface);

      if (!page.entered) send({ kind: "enter", key: page.key });
    },
  }));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- compiles the designs for the sandbox whenever the store publishes new text
  useEffect(() => {
    shell.current.built += 1;
    const mine = shell.current.built;

    void Promise.all([buildBoard(designs), readPageAddresses(designs)]).then((built) => {
      const load = built[0];

      if (shell.current.built !== mine) return;
      const last = shell.current.load;
      shell.current.load = load;
      shell.current.accepted = new Map([...shell.current.addresses, ...built[1]]);
      shell.current.addresses = built[1];

      if (last?.build !== load.build) send(load);
    });
  }, [designs]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the running sandbox the board's Day or Night
  useLayoutEffect(() => send({ kind: "theme", night: input.night }), [input.night]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the running sandbox the window's appearance, which its chrome follows
  useLayoutEffect(() => send(chromeMessage(shown)), [shown]);

  useMountEffect(() => {
    let seen = 0;
    const browser = nyte.host.browser;
    const workspace = input.workspacePath;

    const live =
      browser === undefined || workspace === undefined
        ? undefined
        : boardPages({
            browser,
            owner: { kind: "project", path: workspace },
            addresses: () => shell.current.accepted,
            frame: () => frame.current,
            stills: () => stills.current,
            send,
            onActive: (page) => paged(page),
          });

    pages.current = live;
    const place = (): void => live?.measure();
    const moved = new ResizeObserver(place);

    if (live !== undefined) {
      for (let node: Element | null = frame.current; node !== null; node = node.parentElement) {
        moved.observe(node);
      }
    }
    window.addEventListener("resize", place);
    place();

    const receive = (event: MessageEvent<unknown>): void => {
      const message = readBoardMessage(event.data);

      if (event.source !== frame.current?.contentWindow || message === undefined) return;

      switch (message.kind) {
        case "ready":
          greet();

          return;
        case "zoom":
          zoomed(message.zoom);

          return;
        case "select":
          shone(message.span === null ? null : { kind: "span", ...message.span });

          return;
        case "text":
        case "move":
          void edited(message).then(send);

          return;
        case "pages":
          live?.read(message.pages);

          return;
        case "drawn":
          recordDrawn(message);
      }
    };

    window.addEventListener("message", receive);

    const stop = watchLights(() => {
      const now = currentLights();
      const you = now.you;
      const agent = now.agents.at(-1);
      const at = Math.max(you?.at ?? 0, agent?.at ?? 0);
      const fresh = at > seen && follows();

      if (fresh) seen = at;
      const yours = you !== null && you.at === at;
      const own = yours && you.window === HERE && you.from === SURFACE;
      send(lit(!fresh || own ? null : yours ? "you" : "agents"));
    });

    return () => {
      stop();
      window.removeEventListener("message", receive);
      moved.disconnect();
      window.removeEventListener("resize", place);
      pages.current = undefined;
      live?.close();
      clearDrawn();
    };
  });

  return (
    <div {...props(studioStyles.boardBox)}>
      <iframe
        ref={frame}
        src={
          new URL(
            "board/board.html",
            new URL(nyte.canvasShell ?? DEFAULT_SHELL, window.location.href),
          ).href
        }
        title="Design board"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        {...props(studioStyles.board)}
      />
      <div ref={stills} aria-hidden {...props(studioStyles.stills)} />
    </div>
  );
}

function chromeMessage(appearance: Appearance): AppMessage {
  const theme = canvasTheme(appearance);

  return { kind: "chrome", theme: theme.theme, variables: theme.styles?.variables ?? {} };
}

function lightsMessage(store: DesignStore, follow: "you" | "agents" | null): AppMessage {
  const now = store.lights(currentLights());

  return {
    kind: "lights",
    you: now.you?.subject ?? null,
    agents: now.agents.map((light) => light.subject),
    follow,
  };
}

async function applyEdit(store: DesignStore, message: Edited): Promise<AppMessage> {
  const key = message.key;
  const text = store.read(key.path);

  if (text === undefined || textDigest(text) !== message.base) {
    return { kind: "refused", from: key, reason: "changed" };
  }

  if (!key.path.endsWith(".jsx")) return { kind: "refused", from: key, reason: "not-editable" };
  const source = await parseDesign(key.path, text);

  if (store.read(key.path) !== text) return { kind: "refused", from: key, reason: "changed" };

  const changes =
    message.kind === "text"
      ? readWordsChange({ text, source, key, value: message.value })
      : readPlaceChange({ source, key, x: message.x, y: message.y });

  if (changes === undefined) return { kind: "refused", from: key, reason: "not-editable" };

  for (const change of changes) {
    if (text.slice(change.start, change.end) !== change.text) {
      store.edit(key.path, change.start, change.end, change.text);
    }
  }

  const grown = changes.reduce(
    (sum, change) => sum + change.text.length - (change.end - change.start),
    0,
  );

  const to: Span = { path: key.path, start: key.start, end: key.end + grown };

  return { kind: "applied", from: key, to };
}

function readWordsChange(input: {
  readonly text: string;
  readonly source: DesignSource;
  readonly key: Span;
  readonly value: string;
}): Change[] | undefined {
  const element = input.source.elements.find(
    (found) => found.start === input.key.start && found.end === input.key.end,
  );

  if (element === undefined || !element.host || element.words === null) return undefined;
  const words = element.words;
  const change = smallestChange(input.text.slice(words.start, words.end), encodeWords(input.value));

  return [{ start: words.start + change.start, end: words.start + change.end, text: change.text }];
}

function readPlaceChange(input: {
  readonly source: DesignSource;
  readonly key: Span;
  readonly x: number;
  readonly y: number;
}): Change[] | undefined {
  const frame = input.source.frames.find(
    (found) => found.element.start === input.key.start && found.element.end === input.key.end,
  );

  if (frame === undefined || frame.x === null || frame.y === null) return undefined;

  return [
    { ...frame.y, text: String(input.y) },
    { ...frame.x, text: String(input.x) },
  ].toSorted((left, right) => right.start - left.start);
}

function encodeWords(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}
