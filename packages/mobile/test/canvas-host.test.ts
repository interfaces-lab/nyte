import {
  CANVAS_MAX_HEIGHT,
  CANVAS_MIN_HEIGHT,
  errorNotification,
  initializedNotification,
  initializeRequest,
  openLinkRequest,
  readHostMessage,
  renderNotification,
  sizeChangedNotification,
} from "@nyte-ai/plugin/canvas-protocol";
import { describe, expect, it } from "vitest";
import { mobileHostContext, shellEffect, shellScript } from "../src/chat/canvas-host.ts";

describe("shellEffect", () => {
  it("answers the shell's initialize with its request id", () => {
    expect(shellEffect(JSON.stringify(initializeRequest(1, 1)))).toEqual({
      kind: "initialize",
      id: 1,
    });
  });

  it("marks the frame ready once the shell is initialized", () => {
    expect(shellEffect(JSON.stringify(initializedNotification()))).toEqual({ kind: "ready" });
  });

  it("clamps a reported height and scrolls only past the cap", () => {
    expect(shellEffect(JSON.stringify(sizeChangedNotification(320.4)))).toEqual({
      kind: "height",
      height: 320,
      scrolls: false,
    });
    expect(shellEffect(JSON.stringify(sizeChangedNotification(4)))).toEqual({
      kind: "height",
      height: CANVAS_MIN_HEIGHT,
      scrolls: false,
    });
    expect(shellEffect(JSON.stringify(sizeChangedNotification(CANVAS_MAX_HEIGHT + 1)))).toEqual({
      kind: "height",
      height: CANVAS_MAX_HEIGHT,
      scrolls: true,
    });
  });

  it("passes http(s) links on with their request id and drops the rest", () => {
    expect(shellEffect(JSON.stringify(openLinkRequest("link-1", "https://nyte.sh/")))).toEqual({
      kind: "open-link",
      id: "link-1",
      url: "https://nyte.sh/",
    });
    expect(shellEffect(JSON.stringify(openLinkRequest("link-2", "sms:5551234")))).toBeUndefined();
  });

  it("surfaces a load or render error by its message", () => {
    expect(
      shellEffect(
        JSON.stringify(errorNotification({ phase: "render", message: "x is not defined" })),
      ),
    ).toEqual({ kind: "error", message: "x is not defined" });
  });

  it("ignores text that is not a shell message", () => {
    expect(shellEffect("not json")).toBeUndefined();
    expect(shellEffect(JSON.stringify({ type: "something-else" }))).toBeUndefined();
    expect(shellEffect(JSON.stringify({ jsonrpc: "2.0", method: "ui/unknown" }))).toBeUndefined();
  });
});

describe("shellScript", () => {
  it("dispatches the message as a message event on the shell's window, as the shell reads it", () => {
    const message = renderNotification({
      runtime: 1,
      code: "export default () => null",
      title: "T",
    });

    const script = shellScript(message);

    expect(script).toBe(
      `window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(message)} })); true;`,
    );

    const data = /\{ data: (.*) \}\)\); true;$/u.exec(script)?.[1] ?? "";

    expect(readHostMessage(JSON.parse(data))).toEqual({
      kind: "render",
      module: { runtime: 1, code: "export default () => null", title: "T" },
    });
  });
});

describe("mobileHostContext", () => {
  it("names the scheme, the system faces, and touch without hover", () => {
    expect(mobileHostContext("dark")).toEqual({
      theme: "dark",
      styles: {
        variables: {
          "--nyte-font-family-sans": "var(--nyte-ui-font-system)",
          "--nyte-font-family-mono": "var(--nyte-code-font-system)",
        },
      },
      displayMode: "inline",
      platform: "mobile",
      deviceCapabilities: { touch: true, hover: false },
    });
  });
});
