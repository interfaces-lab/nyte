import { ipcRenderer, webFrame } from "electron";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type { CanvasPreviewPage, CanvasPreviewRequest } from "@nyte-ai/plugin/core/canvas-preview";
import { CANVAS_PREVIEW_CHANNELS } from "../shared/canvas-preview.ts";

const page: CanvasPreviewPage = {
  evaluate: (expression) => webFrame.executeJavaScript(expression),
  resize: (width, height) => ipcRenderer.invoke(CANVAS_PREVIEW_CHANNELS.resize, width, height),
  capture: () => ipcRenderer.invoke(CANVAS_PREVIEW_CHANNELS.capture),
};

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
