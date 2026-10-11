import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

/**
 * A stand-in for the runtime shell, speaking the contract's messages: it
 * initializes, renders what it is told (the "module" is JSON naming the
 * height to report and an error to raise) and echoes a theme change back
 * as an error so the host's handling of it shows in the DOM.
 */
const FAKE_SHELL = `<!doctype html><meta charset="utf-8"><script>
const post = (message) => parent.postMessage(message, "*");
const error = (message) => post({ jsonrpc: "2.0", method: "notifications/message", params: { level: "error", logger: "nyte-canvas", data: { phase: "render", message } } });
addEventListener("message", (event) => {
  const message = event.data;
  if (message.id === 1 && message.result) post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  if (message.method === "nyte/notifications/render") {
    const module = JSON.parse(message.params.code);
    if (module.height) post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: module.height } });
    if (module.error) error(module.error);
  }
  if (message.method === "ui/notifications/host-context-changed") error("context:" + message.params.theme);
});
post({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "nyte-canvas", version: "1" }, appCapabilities: {} } });
</script>`;

test("a canvas frame drives the shell protocol", { timeout: 60_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./canvas-frame.browser-test.tsx", import.meta.url),
      `window.nyte = { clientSurface: "web", canvasShell: ${JSON.stringify(`data:text/html;charset=utf-8,${encodeURIComponent(FAKE_SHELL)}`)}, host: { setThemePreference() {} } };`,
    ),
  ).toBe("passed");
});
