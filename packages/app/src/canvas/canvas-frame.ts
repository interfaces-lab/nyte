import {
  canvasStartHeight,
  clampCanvasHeight,
  initializeResult,
  partStateNotification,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type {
  CanvasHostContext,
  CanvasHostInfo,
  CanvasModule,
  Json,
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
  | { readonly kind: "act"; readonly id: JsonRpcId; readonly action: string; readonly input: Json }
  | { readonly kind: "error"; readonly phase: "load" | "render"; readonly message: string };

export function canvasFrameHeight(
  canvas: Pick<CanvasState, "height" | "heights">,
  width: number | undefined,
  reported: number | undefined,
): number {
  return reported === undefined ? canvasStartHeight(canvas, width) : clampCanvasHeight(reported);
}

export function canvasFrameEffects(
  message: ShellMessage,
  frame: {
    readonly hostInfo: CanvasHostInfo;
    readonly hostContext: CanvasHostContext;
    readonly module: CanvasModule;
    readonly part?: Json;
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
      return [
        { kind: "post", message: renderNotification(frame.module) },
        ...(frame.part === undefined
          ? []
          : [{ kind: "post" as const, message: partStateNotification(frame.part) }]),
        { kind: "rendered" },
      ];
    case "size":
      return [{ kind: "height", height: clampCanvasHeight(message.height) }];
    case "open-link":
      return [{ kind: "open-link", id: message.id, url: message.url }];
    case "library":
      return [];
    case "act":
      return [{ kind: "act", id: message.id, action: message.action, input: message.input }];
    case "error":
      return [{ kind: "error", phase: message.phase, message: message.message }];
  }
}
