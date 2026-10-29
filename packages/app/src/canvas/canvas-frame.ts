import {
  canvasStartHeight,
  clampCanvasHeight,
  initializeResult,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type {
  CanvasHostContext,
  CanvasHostInfo,
  CanvasModule,
  JsonRpcId,
  ShellMessage,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";

export type CanvasPost = ReturnType<typeof renderNotification>;

type CanvasFrameEffect =
  | { readonly kind: "post"; readonly message: CanvasPost }
  | { readonly kind: "rendered" }
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open-link"; readonly id: JsonRpcId; readonly url: string }
  | { readonly kind: "error"; readonly phase: "load" | "render"; readonly message: string };

/** Returns the frame's height: what the shell reported, else where the canvas starts at the frame's width. */
export function canvasFrameHeight(
  canvas: Pick<CanvasState, "height" | "heights">,
  width: number | undefined,
  reported: number | undefined,
): number {
  return reported === undefined ? canvasStartHeight(canvas, width) : clampCanvasHeight(reported);
}

/** Answers a shell message; this shell is served beside its libraries, so a library request never comes. */
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
    case "library":
      return [];
    case "error":
      return [{ kind: "error", phase: message.phase, message: message.message }];
  }
}
