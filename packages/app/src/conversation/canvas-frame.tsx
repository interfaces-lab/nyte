import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui/button";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  use,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { canvas } from "@nyte-ai/plugin/canvas/schema";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";
import {
  CANVAS_RUNTIME,
  hostContextChangedNotification,
  openLinkResult,
  readShellMessage,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasHostContext, CanvasHostInfo } from "@nyte-ai/plugin/canvas/protocol";
import type { Plugin } from "@nyte-ai/plugin/client";
import { followedTrace, startSpan } from "@nyte-ai/sdk";
import type { EndSpan } from "@nyte-ai/sdk";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../nyte.ts";
import { useHostState } from "../queries.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { patchDigest } from "../workbench/changes-viewed.ts";
import {
  useVisibleCanvasTab,
  workbenchController,
  workbenchViewKey,
} from "../workbench/controller.ts";
import { canvasFrameEffects, canvasFrameHeight } from "./canvas-frame.ts";
import type { CanvasPost } from "./canvas-frame.ts";
import { readCanvasTheme, subscribeCanvasTheme } from "./canvas-theme.ts";
import type { CanvasTheme } from "./canvas-theme.ts";
import { openConversationLink } from "./external-link.ts";
import type { MentionFile } from "./message-references.ts";
import { PartOrigin } from "./part-origin.ts";
import { linkReference, useCitableFiles } from "./prose.tsx";
import { useReferenceOpener } from "./reference-opener.tsx";
import type { ReferenceOpener } from "./reference-opener.tsx";

const styles = create({
  figure: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    width: "100%",
    marginBlock: space.s2_5,
    marginInline: 0,
  },
  box: {
    position: "relative",
    width: "100%",
    contain: "layout",
    "--_canvas-open-opacity": {
      default: 0,
      ":hover": { [media.hover]: 1 },
      ":focus-within": 1,
      "@media (hover: none)": 1,
    },
  },
  open: {
    position: "absolute",
    insetBlockStart: space.s1,
    insetInlineEnd: space.s1,
    zIndex: 1,
    display: "flex",
    opacity: "var(--_canvas-open-opacity)",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  frame: {
    display: "block",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  message: {
    display: "flex",
    alignItems: "center",
    height: "100%",
    margin: 0,
    color: role.contentSecondary,
  },
  beside: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    height: "100%",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.card,
    color: role.contentSecondary,
  },
  status: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s2,
    margin: 0,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
  dot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: role.bgInteractiveStrong,
  },
});

const DEFAULT_SHELL = "/canvas/index.html";

function hostInfo(): CanvasHostInfo {
  return {
    name: nyte.clientSurface === "desktop" ? "nyte-desktop" : "nyte-web",
    version: String(CANVAS_RUNTIME),
  };
}

function hostContext(theme: CanvasTheme): CanvasHostContext {
  return {
    ...theme,
    displayMode: "inline",
    platform: nyte.clientSurface,
    deviceCapabilities: {
      touch: window.matchMedia("(pointer: coarse)").matches,
      hover: window.matchMedia("(hover: hover)").matches,
    },
  };
}

function post(frame: HTMLIFrameElement | null, message: CanvasPost): void {
  frame?.contentWindow?.postMessage(message, "*");
}

function canvasLink(
  href: string,
  files: readonly MentionFile[],
  opener: ReferenceOpener | undefined,
): (() => void) | undefined {
  const url = URL.parse(href);

  if (url?.protocol === "http:" || url?.protocol === "https:")
    return () => openConversationLink(url.href, opener);
  const reference = linkReference(href, files);

  return reference?.kind === "file" ? opener?.(reference) : undefined;
}

const HEIGHTS_KEY = "nyte.canvas-heights";

const HEIGHTS_KEPT = 200;

const HEIGHTS_SAVE_DELAY_MS = 1_000;

const storedHeights = Type.Array(Type.Tuple([Type.String(), Type.Number()]));

const measuredHeights = new Map<string, number>(readStoredHeights());

function readStoredHeights(): readonly (readonly [string, number])[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HEIGHTS_KEY) ?? "[]");

    return Value.Check(storedHeights, parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let heightsTimer: ReturnType<typeof setTimeout> | undefined;

function rememberHeight(key: string, height: number): void {
  if (measuredHeights.get(key) === height) return;
  measuredHeights.delete(key);
  measuredHeights.set(key, height);

  if (measuredHeights.size > HEIGHTS_KEPT) {
    const [oldest] = measuredHeights.keys();

    if (oldest !== undefined) measuredHeights.delete(oldest);
  }

  heightsTimer ??= setTimeout(saveHeights, HEIGHTS_SAVE_DELAY_MS);
}

function saveHeights(): void {
  heightsTimer = undefined;

  try {
    window.localStorage.setItem(HEIGHTS_KEY, JSON.stringify([...measuredHeights]));
  } catch {
    return;
  }
}

interface CanvasError {
  readonly code: string;
  readonly message: string;
}

/** Heights depend on the width a canvas lays out in, so a narrowed chat keeps its own. */
function heightKey(digest: string, width: number): string {
  return `${digest}@${String(width)}`;
}

/** What drawing one canvas module takes: a part's current state, or one of its revisions. */
export type DrawnCanvas = Pick<
  CanvasState,
  "runtime" | "code" | "title" | "height" | "heights" | "error"
>;

/**
 * Draws one canvas at the height its shell reports, until then at the height
 * a preview measured at its width. `remembered` starts a remounted frame at
 * the height it last reported at this width, for the transcript's virtualized
 * rows; `standIn` takes the canvas's place at that height, so its runtime
 * isn't running.
 */
export function CanvasFrame({
  state,
  report,
  remembered = false,
  action,
  standIn,
}: {
  readonly state: DrawnCanvas;
  /** Records an error the shell hit on the part; absent for a revision that is no longer the part's module. */
  readonly report?: (message: string) => void;
  readonly remembered?: boolean;
  /** Drawn over the frame's top corner. */
  readonly action?: ReactNode;
  readonly standIn?: ReactNode;
}): ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  const [reported, setReported] = useState<{ readonly digest: string; readonly height: number }>();
  const [error, setError] = useState<CanvasError>();
  const digest = patchDigest(state.code);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the box before paint to start the canvas at its height at that width
  useLayoutEffect(() => {
    setWidth(boxRef.current?.clientWidth);
  }, []);

  const reportedHeight =
    reported?.digest === digest
      ? reported.height
      : remembered && width !== undefined
        ? measuredHeights.get(heightKey(digest, width))
        : undefined;

  const tooNew = state.runtime > CANVAS_RUNTIME;
  const height = canvasFrameHeight(state, width, tooNew ? undefined : reportedHeight);
  const failure = error?.code === state.code ? error.message : undefined;

  const resize = (next: number): void => {
    const box = boxRef.current;

    if (remembered && box !== null) rememberHeight(heightKey(digest, box.clientWidth), next);
    setReported({ digest, height: next });
  };

  return (
    <figure aria-label={state.title} {...props(styles.figure)}>
      <div ref={boxRef} {...props(styles.box)} style={{ height }}>
        {action !== undefined && <span {...props(styles.open)}>{action}</span>}
        {standIn ??
          (tooNew ? (
            <p {...props(styles.message)}>Update Nyte to see this canvas.</p>
          ) : (
            <CanvasShell
              state={state}
              report={report}
              onResize={resize}
              onError={(message) => setError({ code: state.code, message })}
            />
          ))}
      </div>
      {standIn === undefined && failure !== undefined && (
        <figcaption role="status" {...props(text.sm, styles.status)}>
          <span aria-hidden="true" {...props(surfaceTheme.red, styles.dot)} />
          {failure}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A canvas in the chat. While the workbench shows the same part, a stand-in
 * takes its place so only one copy runs.
 */
function TranscriptCanvas({
  state,
  report,
}: {
  readonly state: DrawnCanvas;
  readonly report: (message: string) => void;
}): ReactElement {
  const origin = use(PartOrigin);
  const opener = useReferenceOpener();
  const workspacePath = useHostState().data.workspace?.path;
  const besideTab = useVisibleCanvasTab(workspacePath, origin);
  const title = state.title;

  if (besideTab !== undefined)
    return (
      <CanvasFrame
        state={state}
        remembered
        standIn={
          <div {...props(text.sm, styles.beside)}>
            Shown beside chat
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                workbenchController.actions.closeTab({
                  view: workbenchViewKey(workspacePath),
                  id: besideTab,
                })
              }
            >
              Show Here
            </Button>
          </div>
        }
      />
    );

  const openBeside =
    origin === undefined
      ? undefined
      : opener?.({ kind: "canvas", sessionId: origin.sessionId, part: origin.part, title });

  return (
    <CanvasFrame
      state={state}
      report={report}
      remembered
      action={
        openBeside === undefined ? undefined : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  iconOnly
                  icon="split-right"
                  aria-label={`Open ${title} beside chat`}
                  onClick={openBeside}
                />
              }
            />
            <TooltipContent>Open beside chat</TooltipContent>
          </Tooltip>
        )
      }
    />
  );
}

/** The sandboxed iframe running one canvas; unmounting it ends the canvas's runtime. */
function CanvasShell({
  state,
  report,
  onResize,
  onError,
}: {
  readonly state: DrawnCanvas;
  readonly report: ((message: string) => void) | undefined;
  readonly onResize: (height: number) => void;
  readonly onError: (message: string) => void;
}): ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useSyncExternalStore(subscribeCanvasTheme, readCanvasTheme, readCanvasTheme);
  const [initialized, setInitialized] = useState(false);
  const shell = useRef({ initialized: false, reported: new Set<string>() });
  const painted = useRef<EndSpan>(undefined);
  const opener = useReferenceOpener();
  const files = useCitableFiles(opener !== undefined);
  const citable = files.data;
  const runtime = state.runtime;
  const code = state.code;
  const title = state.title;
  const known = state.error;
  const resized = useEffectEvent(onResize);
  const failed = useEffectEvent(onError);
  const reportError = useEffectEvent((message: string) => report?.(message));

  // oxlint-disable-next-line nyte-code/no-direct-effect -- iframe shell messages, answered with the current module, theme and files
  useLayoutEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      const frame = frameRef.current;
      const message = readShellMessage(event.data);

      if (frame === null || event.source !== frame.contentWindow || message === undefined) return;

      for (const effect of canvasFrameEffects(message, {
        hostInfo: hostInfo(),
        hostContext: hostContext(theme),
        module: { runtime, code, title },
      })) {
        switch (effect.kind) {
          case "post":
            post(frame, effect.message);
            break;
          case "rendered":
            shell.current.initialized = true;
            setInitialized(true);
            break;
          case "height":
            painted.current?.({ height: effect.height });
            resized(effect.height);
            break;
          case "open-link": {
            const allowed = document.activeElement === frame && navigator.userActivation.isActive;
            const open = allowed ? canvasLink(effect.url, citable ?? [], opener) : undefined;
            open?.();
            post(frame, openLinkResult(effect.id, open === undefined));
            break;
          }

          case "error": {
            const key = `${code}\n${effect.message}`;
            failed(effect.message);

            if (shell.current.reported.has(key)) break;
            shell.current.reported.add(key);

            if (known !== effect.message) reportError(effect.message);
            break;
          }
        }
      }
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, [theme, runtime, code, title, known, citable, opener]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- posts changed code to the running iframe shell
  useLayoutEffect(() => {
    if (shell.current.initialized)
      post(frameRef.current, renderNotification({ runtime, code, title }));
  }, [runtime, code, title]);

  useMountEffect(() => {
    const ended = startSpan("canvas.paint", followedTrace(), { title });
    painted.current = ended;

    return () => ended({ unmounted: true });
  });

  useMountEffect(() =>
    subscribeCanvasTheme(() => {
      if (shell.current.initialized)
        post(frameRef.current, hostContextChangedNotification(readCanvasTheme()));
    }),
  );

  return (
    <iframe
      ref={frameRef}
      src={nyte.canvasShell ?? DEFAULT_SHELL}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      {...props(styles.frame)}
      style={{ colorScheme: initialized ? theme.theme : "light" }}
    />
  );
}

export const canvasRenderers: Plugin = {
  id: "canvas-renderers",
  contribute: {
    renderers: [
      {
        kind: canvas,
        framework: "react",
        render(part, act) {
          const checked = canvas.state["~standard"].validate(part.state);

          if (checked instanceof Promise || checked.issues !== undefined) return null;

          return (
            <TranscriptCanvas
              state={checked.value}
              report={(message) => void act("report", { message })}
            />
          );
        },
      },
    ],
  },
};
