import { parentPort } from "node:worker_threads";
import { resizeImageInProcess } from "./image-resize-core.ts";
import { checkResizeRequest, type ResizeResponse } from "./image-resize-messages.ts";

const port = parentPort;
if (!port) {
  throw new Error("image resize worker requires parentPort");
}

port.once("message", (message) => {
  void (async () => {
    try {
      if (!checkResizeRequest.Check(message)) {
        throw new Error("Invalid image resize worker request");
      }
      const result = await resizeImageInProcess(
        message.inputBytes,
        message.mimeType,
        message.options,
      );
      const response: ResizeResponse = { result };
      port.postMessage(response);
    } catch (error) {
      const response: ResizeResponse = {
        error: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    }
  })();
});
