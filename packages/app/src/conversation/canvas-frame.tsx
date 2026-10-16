import { create, props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
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
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../nyte.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { patchDigest } from "../workbench/changes-viewed.ts";
import { canvasFrameEffects, canvasFrameHeight } from "./canvas-frame.ts";
import type { CanvasPost } from "./canvas-frame.ts";
import { readCanvasTheme, subscribeCanvasTheme } from "./canvas-theme.ts";
import type { CanvasTheme } from "./canvas-theme.ts";
import { openExternalLink } from "./external-link.ts";

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

const HEIGHTS_KEY = "nyte.canvas-heights";

/** Canvases whose last reported height is kept; older ones paint at their hint again. */
const HEIGHTS_KEPT = 200;

const storedHeights = Type.Array(Type.Tuple([Type.String(), Type.Number()]));

/**
 * The height each canvas last reported, by a digest of its code. A canvas
 * reloads whenever its row remounts (virtualized scrolling, switching chats,
 * a restart), and seeding the frame with this keeps it from opening at the
 * agent's hint and jumping when the shell measures.
 */
const measuredHeights = new Map<string, number>(readStoredHeights());

function readStoredHeights(): readonly (readonly [string, number])[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HEIGHTS_KEY) ?? "[]");

    return Value.Check(storedHeights, parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberHeight(key: string, height: number): void {
  if (measuredHeights.get(key) === height) return;
  measuredHeights.delete(key);
  measuredHeights.set(key, height);

  for (const stale of [...measuredHeights.keys()].slice(0, -HEIGHTS_KEPT))
    measuredHeights.delete(stale);

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

export function CanvasFrame({
  state,
  report,
}: {
  readonly state: CanvasState;
  readonly report: (message: string) => void;
}): ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useSyncExternalStore(subscribeCanvasTheme, readCanvasTheme, readCanvasTheme);
  const { runtime, code, title, error: known } = state;
  const heightKey = useMemo(() => patchDigest(code), [code]);
  const [reported, setReported] = useState<{ readonly key: string; readonly height: number }>();
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<CanvasError>();
  const shell = useRef({ initialized: false, reported: new Set<string>() });

  const reportedHeight =
    reported?.key === heightKey ? reported.height : measuredHeights.get(heightKey);

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
            rememberHeight(heightKey, effect.height);
            setReported({ key: heightKey, height: effect.height });
            break;
          case "open-link": {
            const allowed = document.activeElement === frame && navigator.userActivation.isActive;
            if (allowed) openExternalLink(effect.url);
            post(frame, openLinkResult(effect.id, !allowed));
            break;
          }

          case "error": {
            const key = `${code}\n${effect.message}`;
            setError({ code, message: effect.message });

            if (shell.current.reported.has(key)) break;
            shell.current.reported.add(key);

            if (known !== effect.message) report(effect.message);
            break;
          }
        }
      }
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, [theme, runtime, code, title, known, report, heightKey]);

  useLayoutEffect(() => {
    if (shell.current.initialized)
      post(frameRef.current, renderNotification({ runtime, code, title }));
  }, [runtime, code, title]);

  useMountEffect(() =>
    subscribeCanvasTheme(() => {
      if (shell.current.initialized)
        post(frameRef.current, hostContextChangedNotification(readCanvasTheme()));
    }),
  );

  const tooNew = runtime > CANVAS_RUNTIME;
  const height = canvasFrameHeight(state.height, tooNew ? undefined : reportedHeight);
  const failure = error?.code === code ? error.message : undefined;

  return (
    <figure aria-label={title} {...props(styles.figure)}>
      <div {...props(styles.box)} style={{ height }}>
        {tooNew ? (
          <p {...props(styles.message)}>Update Nyte to see this canvas.</p>
        ) : (
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
        )}
      </div>
      {failure !== undefined && (
        <figcaption role="status" {...props(text.sm, styles.status)}>
          <span aria-hidden="true" {...props(surfaceTheme.red, styles.dot)} />
          {failure}
        </figcaption>
      )}
    </figure>
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
            <CanvasFrame
              state={checked.value}
              report={(message) => void act("report", { message })}
            />
          );
        },
      },
    ],
  },
};
