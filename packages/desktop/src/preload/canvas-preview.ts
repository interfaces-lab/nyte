/**
 * An offscreen canvas preview's driver, in the preview window beside the shell it drives:
 * `runCanvasPreview` evaluates its harness in the page's main world and asks main only for what a
 * page cannot do itself, resizing and capturing its window. Main loads it with each preview
 * window, so the previewer is never part of main's own startup.
 */
import { ipcRenderer, webFrame } from "electron";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type { CanvasPreviewPage, CanvasPreviewRequest } from "@nyte-ai/plugin/core/canvas-preview";
import { CANVAS_PREVIEW_CHANNELS } from "../shared/canvas-preview.ts";

const page: CanvasPreviewPage = {
  evaluate: (expression) => webFrame.executeJavaScript(expression),
  resize: (width, height) => ipcRenderer.invoke(CANVAS_PREVIEW_CHANNELS.resize, width, height),
  capture: () => ipcRenderer.invoke(CANVAS_PREVIEW_CHANNELS.capture),
};

/** Runs the preview main sent and answers with its report, or with why it failed. */
async function drive(request: CanvasPreviewRequest): Promise<void> {
  try {
    const report = await runCanvasPreview(page, request);
    ipcRenderer.send(CANVAS_PREVIEW_CHANNELS.outcome, { kind: "rendered", report });
  } catch (error) {
    ipcRenderer.send(CANVAS_PREVIEW_CHANNELS.outcome, {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

ipcRenderer.once(CANVAS_PREVIEW_CHANNELS.run, (_event, request: CanvasPreviewRequest) => {
  void drive(request);
});
