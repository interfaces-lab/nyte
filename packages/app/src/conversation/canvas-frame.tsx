import { create, props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
  const [reportedHeight, setReportedHeight] = useState<number>();
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<CanvasError>();
  const shell = useRef({ initialized: false, reported: new Set<string>() });
  const { runtime, code, title, error: known } = state;

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
            setReportedHeight(effect.height);
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
  }, [theme, runtime, code, title, known, report]);

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
