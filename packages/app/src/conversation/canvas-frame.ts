/**
 * The host half of the canvas protocol, without the DOM: what a frame posts
 * back and does for each message the shell sends, and how tall it stands.
 */
import {
  CANVAS_DEFAULT_HEIGHT,
  clampCanvasHeight,
  initializeResult,
  renderNotification,
} from "@nyte-ai/plugin/canvas-protocol";
import type {
  CanvasHostContext,
  CanvasHostInfo,
  CanvasModule,
  JsonRpcId,
  ShellMessage,
} from "@nyte-ai/plugin/canvas-protocol";

export type CanvasPost = ReturnType<typeof renderNotification>;

export type CanvasFrameEffect =
  | { readonly kind: "post"; readonly message: CanvasPost }
  | { readonly kind: "rendered" }
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | { readonly kind: "error"; readonly phase: "load" | "render"; readonly message: string };

/** The frame's height: the agent's hint, or the default, until the shell reports its own. */
export function canvasFrameHeight(hint: number | null, reported: number | undefined): number {
  return clampCanvasHeight(reported ?? hint ?? CANVAS_DEFAULT_HEIGHT);
}

/** What one shell message makes the frame do. */
export function canvasFrameEffects(
  message: ShellMessage,
  frame: {
    readonly hostInfo: CanvasHostInfo;
    readonly hostContext: CanvasHostContext;
    readonly module: CanvasModule;
  },
): readonly CanvasFrameEffect[] {
  switch (message.kind) {
    case "initialize":
      return [
        {
          kind: "post",
          message: initializeResult(message.id, frame.hostInfo, frame.hostContext),
        },
      ];
    case "initialized":
      return [{ kind: "post", message: renderNotification(frame.module) }, { kind: "rendered" }];
    case "size":
      return [{ kind: "height", height: clampCanvasHeight(message.height) }];
    case "open-link":
      return [{ kind: "open-link", id: message.id, url: message.url }];
    case "error":
      return [{ kind: "error", phase: message.phase, message: message.message }];
  }
}
