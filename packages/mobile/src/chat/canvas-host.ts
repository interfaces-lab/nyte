import {
  CANVAS_MAX_HEIGHT,
  CANVAS_STARTUP_CONTEXT,
  clampCanvasHeight,
  hostContextChangedNotification,
  readShellMessage,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasHostContext, CanvasLibrary, JsonRpcId } from "@nyte-ai/plugin/canvas/protocol";

export type ShellBound = ReturnType<typeof renderNotification>;

export type CanvasEffect =
  | { readonly kind: "initialize"; readonly id: JsonRpcId }
  | { readonly kind: "ready" }
  | { readonly kind: "height"; readonly height: number; readonly scrolls: boolean }
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | { readonly kind: "library"; readonly name: CanvasLibrary }
  | { readonly kind: "error"; readonly message: string };

export function shellScript(message: ShellBound): string {
  return `window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(message)} })); true;`;
}

/** Hands the shell its host context before its scripts run, so its first frame is already in the app's scheme. */
export function startupScript(theme: "light" | "dark"): string {
  return `window.${CANVAS_STARTUP_CONTEXT} = ${JSON.stringify(hostContextChangedNotification(mobileHostContext(theme)))}; true;`;
}

export function shellEffect(data: string): CanvasEffect | undefined {
  let posted: unknown;

  try {
    posted = JSON.parse(data);
  } catch {
    return undefined;
  }

  const message = readShellMessage(posted);

  if (message === undefined) return undefined;

  switch (message.kind) {
    case "initialize":
      return { kind: "initialize", id: message.id };
    case "initialized":
      return { kind: "ready" };
    case "size":
      return {
        kind: "height",
        height: clampCanvasHeight(message.height),
        scrolls: message.height > CANVAS_MAX_HEIGHT,
      };
    case "open-link":
      return { kind: "open-link", id: message.id, url: message.url };
    case "library":
      return { kind: "library", name: message.name };
    case "error":
      return { kind: "error", message: message.message };
    default: {
      const exhaustive: never = message;

      return exhaustive;
    }
  }
}

export function mobileHostContext(theme: "light" | "dark"): CanvasHostContext {
  return {
    theme,
    styles: {
      variables: {
        "--nyte-font-family-sans": "var(--nyte-ui-font-system)",
        "--nyte-font-family-mono": "var(--nyte-code-font-system)",
      },
    },
    displayMode: "inline",
    platform: "mobile",
    deviceCapabilities: { touch: true, hover: false },
  };
}
