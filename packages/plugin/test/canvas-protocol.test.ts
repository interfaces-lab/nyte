import { describe, expect, it } from "vitest";
import {
  CANVAS_RUNTIME,
  CANVAS_VARIABLES,
  KIT,
  KIT_EXPORTS,
  clampCanvasHeight,
  errorNotification,
  hostContextChangedNotification,
  initializeRequest,
  initializeResult,
  initializedNotification,
  openLinkRequest,
  openLinkResult,
  readHostMessage,
  readShellMessage,
  renderNotification,
  sanitizeCanvasVariables,
  sizeChangedNotification,
} from "../src/canvas/canvas-protocol.ts";
import type { CanvasHostContext } from "../src/canvas/canvas-protocol.ts";

const context: CanvasHostContext = {
  theme: "dark",
  styles: { variables: { "--nyte-custom-hue": "250", "--nyte-custom-chroma-scale": "0.4" } },
  displayMode: "inline",
  platform: "desktop",
  deviceCapabilities: { touch: false, hover: true },
};

const wire = (message: unknown): unknown => JSON.parse(JSON.stringify(message));

describe("the shell's messages", () => {
  it("read back what the builders make, in the MCP Apps shape", () => {
    expect(wire(initializeRequest(1, CANVAS_RUNTIME))).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: { appInfo: { name: "nyte-canvas", version: "1" } },
    });
    expect(readShellMessage(wire(initializeRequest(1, CANVAS_RUNTIME)))).toEqual({
      kind: "initialize",
      id: 1,
      runtime: 1,
    });
    expect(readShellMessage(wire(initializedNotification()))).toEqual({ kind: "initialized" });
    expect(wire(sizeChangedNotification(312))).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { height: 312 },
    });
    expect(readShellMessage(wire(sizeChangedNotification(312)))).toEqual({
      kind: "size",
      height: 312,
    });
    expect(wire(openLinkRequest("link-1", "https://nyte.sh/"))).toEqual({
      jsonrpc: "2.0",
      id: "link-1",
      method: "ui/open-link",
      params: { url: "https://nyte.sh/" },
    });
    expect(readShellMessage(wire(openLinkRequest("link-1", "https://nyte.sh/")))).toEqual({
      kind: "open-link",
      id: "link-1",
      url: "https://nyte.sh/",
    });
    expect(wire(errorNotification({ phase: "render", message: "boom", stack: "at View" }))).toEqual(
      {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "error",
          logger: "nyte-canvas",
          data: { phase: "render", message: "boom", stack: "at View" },
        },
      },
    );
    expect(
      readShellMessage(wire(errorNotification({ phase: "load", message: "no default" }))),
    ).toEqual({ kind: "error", phase: "load", message: "no default", stack: null });
  });

  it("refuse what is not one: other envelopes, non-http links, bad sizes, unknown methods", () => {
    expect(readShellMessage(null)).toBeUndefined();
    expect(readShellMessage("hello")).toBeUndefined();
    expect(
      readShellMessage({ jsonrpc: "1.0", method: "ui/notifications/initialized" }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { height: -1 },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { height: "tall" },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "ui/open-link",
        params: { url: "javascript:alert(1)" },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "ui/open-link",
        params: { url: "file:///etc/passwd" },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://nyte.sh/" },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: { appInfo: { version: "0" } },
      }),
    ).toBeUndefined();
    expect(
      readShellMessage({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "info", data: { phase: "load", message: "x" } },
      }),
    ).toBeUndefined();
    expect(readShellMessage({ jsonrpc: "2.0", method: "ui/message", params: {} })).toBeUndefined();
  });
});

describe("the host's messages", () => {
  it("read back what the builders make", () => {
    const result = wire(initializeResult(1, { name: "nyte-web", version: "0.0.17" }, context));

    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2026-01-26",
        hostContext: { theme: "dark", styles: { variables: { "--nyte-custom-hue": "250" } } },
      },
    });
    expect(readHostMessage(result)).toEqual({
      kind: "initialize-result",
      id: 1,
      hostInfo: { name: "nyte-web", version: "0.0.17" },
      hostContext: context,
    });

    const module = { runtime: 1, code: "export default () => null;", title: "Totals" };

    expect(wire(renderNotification(module))).toEqual({
      jsonrpc: "2.0",
      method: "nyte/notifications/render",
      params: module,
    });
    expect(readHostMessage(wire(renderNotification(module)))).toEqual({ kind: "render", module });
    expect(readHostMessage(wire(hostContextChangedNotification({ theme: "light" })))).toEqual({
      kind: "context-changed",
      context: { theme: "light" },
    });
    expect(readHostMessage(wire(openLinkResult("link-1")))).toEqual({
      kind: "open-link-result",
      id: "link-1",
      isError: false,
    });
    expect(readHostMessage(wire(openLinkResult("link-1", true)))).toEqual({
      kind: "open-link-result",
      id: "link-1",
      isError: true,
    });
  });

  it("drop variables outside the allowlist and strip what could end a declaration", () => {
    const changed = readHostMessage(
      wire(
        hostContextChangedNotification({
          styles: {
            variables: {
              "--nyte-font-size-base": "14px; } body { display: none",
              "--evil": "x",
              "--nyte-custom-hue": "<b>",
            },
          },
        }),
      ),
    );

    expect(changed).toEqual({
      kind: "context-changed",
      context: {
        styles: {
          variables: {
            "--nyte-font-size-base": "14px  body  display: none",
            "--nyte-custom-hue": "b",
          },
        },
      },
    });
    expect(
      Object.keys(sanitizeCanvasVariables({ "--nyte-reduce-transparency": "1", color: "red" })),
    ).toEqual(["--nyte-reduce-transparency"]);
    expect(CANVAS_VARIABLES).toContain("--nyte-custom-chroma-scale");
  });

  it("refuse an incomplete initialize result, a bad render and a bad context", () => {
    expect(
      readHostMessage({ jsonrpc: "2.0", id: 1, result: { hostContext: { theme: "dark" } } }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        jsonrpc: "2.0",
        id: 1,
        result: { hostInfo: { name: "other", version: "1" }, hostContext: context },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        jsonrpc: "2.0",
        method: "nyte/notifications/render",
        params: { runtime: 0, code: "", title: "t" },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        jsonrpc: "2.0",
        method: "nyte/notifications/render",
        params: { runtime: 1, code: 1, title: "t" },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme: "sepia" },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { styles: { variables: "none" } },
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: {} }),
    ).toBeUndefined();
  });
});

it("clamps a frame height to the range", () => {
  expect(clampCanvasHeight(10)).toBe(48);
  expect(clampCanvasHeight(312.4)).toBe(312);
  expect(clampCanvasHeight(9000)).toBe(2000);
});

it("lists the kit in signature order, every entry with a signature", () => {
  expect(KIT_EXPORTS).toEqual(Object.keys(KIT));
  expect(KIT_EXPORTS[0]).toBe("Stack");
  expect(KIT_EXPORTS).toContain("LineChart");
  expect(KIT_EXPORTS).toContain("useColorScheme");

  for (const signature of Object.values(KIT)) expect(signature.length).toBeGreaterThan(1);
});
