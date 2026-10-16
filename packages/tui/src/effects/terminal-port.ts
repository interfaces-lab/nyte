import process from "node:process";
import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  decodePasteBytes,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import open from "open";
import type { TerminalPort } from "./ports.ts";

export function terminalPort(
  renderer: CliRenderer,
  options: { readonly write: (text: string) => void },
): TerminalPort & { dispose(): Promise<void> } {
  const clipboard = createClipboard({
    host: createHostClipboard(),
    terminal: createRendererClipboardAdapter(renderer),
  });

  return {
    setTitle: (title) => renderer.setTerminalTitle(title),
    programStatus: (encoded) => options.write(encoded),
    notify(title, body, sound) {
      renderer.triggerNotification(body, title);

      if (sound && process.stdout.isTTY) process.stdout.write("\u0007");
    },
    copy(text) {
      // OpenTUI rejects NUL before any destination; host clipboard text cannot contain it.
      void clipboard
        .writeText(text.replaceAll("\0", ""), {
          destination: "all-available",
          selection: "clipboard",
        })
        .catch(() => undefined);
    },
    async readClipboard() {
      const result = await clipboard.read({
        preferredTypes: ["image/png", "text/plain"],
        selection: "clipboard",
      });

      if (result.status !== "read") {
        if (result.status === "failed") throw result.error;

        if (result.status === "timed-out") throw new Error("Clipboard read timed out");

        if (result.status === "limit-exceeded")
          throw new RangeError("Clipboard content exceeded the read or image conversion limit");

        return { kind: "empty" };
      }

      if (result.representation.mimeType === "image/png")
        return { kind: "image", bytes: result.representation.bytes };

      if (result.representation.bytes.length === 0) return { kind: "empty" };

      return { kind: "text", text: decodePasteBytes(result.representation.bytes) };
    },
    async suspended(work) {
      await renderer.suspend();

      try {
        return await work();
      } finally {
        await renderer.resume();
        renderer.requestRender();
      }
    },
    open(target) {
      void open(target).catch(() => undefined);
    },
    painted() {
      renderer.requestRender();

      return renderer.idle();
    },
    dispose: () => clipboard.dispose(),
  };
}
