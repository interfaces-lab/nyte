import { compile, SdkError } from "@nyte-ai/schema";
import type { ActionDeclaration } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { ClientActions } from "../browser-client.ts";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewRequest,
  CanvasPreviewer,
} from "./canvas-preview.ts";

export const CANVAS_PREVIEW_ACTION = {
  name: "canvas.preview",
  summary: "Renders a canvas off-screen in this app and reports what it saw.",
  input: { type: "object" },
} as const satisfies ActionDeclaration;

const PERFORM_MS = 30_000;

export const CanvasPreviewCallType = Type.Object({
  module: Type.Object({ runtime: Type.Number(), code: Type.String(), title: Type.String() }),
  theme: Type.Enum(["light", "dark"]),
});

export const CanvasPreviewAnswerType = Type.Union([
  Type.Object({
    kind: Type.Literal("rendered"),
    report: Type.Object({
      png: Type.String(),
      heights: Type.Object({ chat: Type.Number(), phone: Type.Number() }),
      errors: Type.Array(
        Type.Object({
          phase: Type.Enum(["load", "render"]),
          message: Type.String(),
          stack: Type.Union([Type.String(), Type.Null()]),
        }),
      ),
      console: Type.Array(Type.Object({ level: Type.String(), text: Type.String() })),
    }),
  }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: Type.String() }),
]);

export type CanvasPreviewAnswer = Static<typeof CanvasPreviewAnswerType>;

const previewAnswers = compile(CanvasPreviewAnswerType);

/**
 * Returns a previewer that renders in the connected app that offers
 * `CANVAS_PREVIEW_ACTION`, and in `fallback` while none does. The app
 * answers within 30 seconds, the longest a client action waits.
 *
 * @category plugins
 * @since 0.1.0
 */
export function clientCanvasPreview(
  actions: ClientActions,
  fallback: CanvasPreviewer,
): CanvasPreviewer {
  return async (request, signal) => {
    if (!actions.offered(CANVAS_PREVIEW_ACTION.name)) return fallback(request, signal);
    const answered = await actions
      .perform(CANVAS_PREVIEW_ACTION.name, previewInput(request), PERFORM_MS)
      .catch((error: unknown) => {
        if (error instanceof SdkError && error.code === "not_supported") return null;

        throw error;
      });

    if (answered === null) return fallback(request, signal);

    if (!previewAnswers.Check(answered))
      throw new SdkError("invalid", "The app answered a canvas preview with something unreadable.");

    return readAnswer(answered);
  };
}

function previewInput(request: CanvasPreviewRequest) {
  return {
    module: {
      runtime: request.module.runtime,
      code: request.module.code,
      title: request.module.title,
    },
    theme: request.theme,
  };
}

function readAnswer(answer: CanvasPreviewAnswer): CanvasPreviewOutcome {
  if (answer.kind === "unavailable") return answer;

  return {
    kind: "rendered",
    report: { ...answer.report, png: Uint8Array.fromBase64(answer.report.png) },
  };
}
