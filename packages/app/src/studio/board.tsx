import { props } from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { ReactElement, Ref } from "react";
import { readBoardMessage } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage, BoardMessage, Span } from "@nyte-ai/plugin/design/board-protocol";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { canvasTheme } from "../canvas/canvas-theme.ts";
import { nyte } from "../contract/nyte.ts";
import { currentLights, HERE, watchLights } from "../light/light.ts";
import { useAppearance } from "../theme/appearance-store.ts";
import type { Appearance } from "../theme/appearance-store.ts";
import { buildBoard } from "./design-compile.ts";
import type { BoardLoad } from "./design-compile.ts";
import { parseDesign } from "./design-source.ts";
import type { Range } from "./design-source.ts";
import { designLights, edit, readDesign, shineDesign, SURFACE } from "./designs.ts";
import type { Designs } from "./designs.ts";
import { studioStyles } from "./studio.stylex.ts";

export type BoardCamera = Extract<AppMessage, { kind: "camera" }>["to"];

export interface BoardHandle {
  /** Flies the camera to a file's frames. */
  reveal(path: string): void;
  /** Fits every frame, shows the board at 100%, or frames the selection. */
  camera(to: BoardCamera): void;
}

type Edited = Extract<BoardMessage, { kind: "text" } | { kind: "move" }>;

const DEFAULT_SHELL = "/canvas/index.html";

/**
 * The board: every design file drawn in a sandboxed frame of the canvas shell, which runs the designs' code so this
 * window never does. This side compiles the designs, keeps the board told about the light, and turns what the person
 * does there into the light and into edits of literal text and frame places.
 */
export function Board(input: {
  readonly designs: Designs;
  readonly night: boolean;
  readonly following: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly handle: Ref<BoardHandle>;
}): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);

  const shell = useRef<{ ready: boolean; load: BoardLoad | null; built: number }>({
    ready: false,
    load: null,
    built: 0,
  });

  const shown = useAppearance();
  const designs = input.designs;

  const send = (message: AppMessage): void => {
    if (shell.current.ready) frame.current?.contentWindow?.postMessage(message, "*");
  };

  const follows = useEffectEvent((): boolean => input.following);
  const zoomed = useEffectEvent((zoom: number) => input.onZoom(zoom));

  const greet = useEffectEvent((): void => {
    shell.current.ready = true;
    send(chromeMessage(shown));
    send({ kind: "theme", night: input.night });
    send(
      lightsMessage(input.following && designLights(currentLights()).you !== null ? "you" : null),
    );

    if (shell.current.load !== null) send(shell.current.load);
  });

  useImperativeHandle(input.handle, () => ({
    reveal: (path) => send({ kind: "reveal", path }),
    camera: (to) => send({ kind: "camera", to }),
  }));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- compiles the designs for the sandbox whenever the store publishes new text
  useEffect(() => {
    shell.current.built += 1;
    const mine = shell.current.built;

    void buildBoard(designs).then((load) => {
      if (shell.current.built !== mine) return;
      const last = shell.current.load;
      shell.current.load = load;

      if (last === null || JSON.stringify(last) !== JSON.stringify(load)) send(load);
    });
  }, [designs]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the running sandbox the board's Day or Night
  useLayoutEffect(() => send({ kind: "theme", night: input.night }), [input.night]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- tells the running sandbox the window's appearance, which its chrome follows
  useLayoutEffect(() => send(chromeMessage(shown)), [shown]);

  useMountEffect(() => {
    let seen = 0;

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
          shineDesign(message.span === null ? null : { kind: "span", ...message.span });

          return;
        case "text":
        case "move":
          void applyEdit(message).then(send);
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
      send(lightsMessage(!fresh || own ? null : yours ? "you" : "agents"));
    });

    return () => {
      stop();
      window.removeEventListener("message", receive);
    };
  });

  return (
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
  );
}

function chromeMessage(appearance: Appearance): AppMessage {
  const theme = canvasTheme(appearance);

  return { kind: "chrome", theme: theme.theme, variables: theme.styles?.variables ?? {} };
}

function lightsMessage(follow: "you" | "agents" | null): AppMessage {
  const now = designLights(currentLights());

  return {
    kind: "lights",
    you: now.you?.subject ?? null,
    agents: now.agents.map((light) => light.subject),
    follow,
  };
}

async function applyEdit(message: Edited): Promise<AppMessage> {
  const key = message.key;
  const refused: AppMessage = { kind: "refused", from: key };
  const text = readDesign(key.path);

  if (
    text === undefined ||
    !key.path.startsWith("design/") ||
    !key.path.endsWith(".jsx") ||
    key.path.split("/").some((part) => part === ".." || part === "." || part === "")
  )
    return refused;
  const source = await parseDesign(key.path, text);

  const element = source.elements.find(
    (found) => found.start === key.start && found.end === key.end,
  );

  if (element === undefined || readDesign(key.path) !== text) return refused;

  const changes =
    message.kind === "text"
      ? element.host && element.words !== null
        ? [smallestPatch(text, element.words, encodeWords(message.value))]
        : null
      : element.x !== null && element.y !== null
        ? [
            { ...element.y, text: String(message.y) },
            { ...element.x, text: String(message.x) },
          ].toSorted((left, right) => right.start - left.start)
        : null;

  if (changes === null) return refused;

  for (const change of changes)
    if (text.slice(change.start, change.end) !== change.text)
      edit(key.path, change.start, change.end, change.text);

  const grown = changes.reduce(
    (sum, change) => sum + change.text.length - (change.end - change.start),
    0,
  );

  const to: Span = { path: key.path, start: key.start, end: key.end + grown };

  return { kind: "applied", from: key, to };
}

function encodeWords(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function smallestPatch(
  text: string,
  range: Range,
  next: string,
): Range & { readonly text: string } {
  const before = text.slice(range.start, range.end);
  let head = 0;

  while (head < before.length && head < next.length && before[head] === next[head]) head += 1;
  let tail = 0;

  while (
    tail < before.length - head &&
    tail < next.length - head &&
    before[before.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;

  return {
    start: range.start + head,
    end: range.end - tail,
    text: next.slice(head, next.length - tail),
  };
}
