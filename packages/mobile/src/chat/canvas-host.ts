import {
  CANVAS_MAX_HEIGHT,
  clampCanvasHeight,
  readShellMessage,
  renderNotification,
} from "@nyte-ai/plugin/canvas-protocol";
import type { CanvasHostContext, JsonRpcId } from "@nyte-ai/plugin/canvas-protocol";

/** A message bound for the shell, as the protocol builders return it. */
export type ShellBound = ReturnType<typeof renderNotification>;

/** What the frame does with one message the shell posted. */
export type CanvasEffect =
  | { readonly kind: "initialize"; readonly id: JsonRpcId }
  | { readonly kind: "ready" }
  | { readonly kind: "height"; readonly height: number; readonly scrolls: boolean }
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | { readonly kind: "error"; readonly message: string };

/** Returns the script that delivers one host message to the shell: a `message` event on its window, as the contract's iOS transport defines it. */
export function shellScript(message: ShellBound): string {
  return `window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(message)} })); true;`;
}

/** Returns what the frame does with the text the shell posted, or undefined for anything that is not a shell message. */
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
    case "error":
      return { kind: "error", message: message.message };
    default: {
      const exhaustive: never = message;

      return exhaustive;
    }
  }
}

/** Returns what this app tells the shell about where it runs: the scheme, the system faces, touch without hover. */
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
