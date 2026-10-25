import { isPart, tool } from "@nyte-ai/plugin/client";
import { CANVAS_RENDER_TOOL } from "@nyte-ai/plugin/canvas/schema";
import { isJsonObject } from "@nyte-ai/schema";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { sessionWatch, useWatchSelect } from "../sdk.tsx";

/** Whether the agent is rewriting a canvas: a `canvas_render` call naming it has not settled in its chat. */
export function useCanvasEditing(sessionId: SessionId, part: PartId): boolean {
  return useWatchSelect(
    sessionWatch(sessionId),
    ({ value }) =>
      value?.messages.some(
        (message) =>
          isPart(message, tool) &&
          message.state.name === CANVAS_RENDER_TOOL &&
          message.state.phase !== "settled" &&
          isJsonObject(message.state.args) &&
          message.state.args.canvas === part,
      ) ?? false,
  );
}
