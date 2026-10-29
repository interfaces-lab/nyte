import {
  CANVAS_MAX_HEIGHT,
  CANVAS_MIN_HEIGHT,
  readShellMessage,
  readHostMessage,
  errorNotification,
  initializeRequest,
  initializedNotification,
  openLinkRequest,
  sizeChangedNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasHostContext, ShellMessage } from "@nyte-ai/plugin/canvas/protocol";
import { describe, expect, test } from "vitest";
import { canvasFrameEffects, canvasFrameHeight } from "./canvas-frame.ts";

const hostContext: CanvasHostContext = {
  theme: "dark",
  styles: { variables: { "--nyte-custom-hue": "250" } },
  displayMode: "inline",
  platform: "web",
  deviceCapabilities: { touch: false, hover: true },
};

const frame = {
  hostInfo: { name: "nyte-web" as const, version: "1" },
  hostContext,
  module: { runtime: 1, code: "export default () => null;", title: "Revenue" },
};

function shellMessage(data: ReturnType<typeof initializeRequest>): ShellMessage {
  const message = readShellMessage(data);

  if (message === undefined) throw new Error("not a shell message");

  return message;
}

describe("canvas frame height", () => {
  test("stands at the hint, or the default, until the shell reports", () => {
    expect(canvasFrameHeight({ height: null }, undefined, undefined)).toBe(80);
    expect(canvasFrameHeight({ height: 320 }, undefined, undefined)).toBe(320);
    expect(canvasFrameHeight({ height: 320 }, undefined, 512)).toBe(512);
  });

  test("clamps the hint and the report alike", () => {
    expect(canvasFrameHeight({ height: 10 }, undefined, undefined)).toBe(CANVAS_MIN_HEIGHT);
    expect(canvasFrameHeight({ height: null }, undefined, 4_000)).toBe(CANVAS_MAX_HEIGHT);
    expect(canvasFrameHeight({ height: null }, undefined, 100.4)).toBe(100);
  });
});

describe("canvas frame effects", () => {
  test("answers initialize with the host context", () => {
    const effects = canvasFrameEffects(shellMessage(initializeRequest(1, 1)), frame);

    expect(effects).toHaveLength(1);
    const [effect] = effects;

    if (effect?.kind !== "post") throw new Error("expected a post");
    expect(readHostMessage(effect.message)).toEqual({
      kind: "initialize-result",
      id: 1,
      hostInfo: frame.hostInfo,
      hostContext,
    });
  });

  test("renders the module once initialized and remembers it", () => {
    const effects = canvasFrameEffects(shellMessage(initializedNotification()), frame);

    expect(effects.map((effect) => effect.kind)).toEqual(["post", "rendered"]);
    const [effect] = effects;

    if (effect?.kind !== "post") throw new Error("expected a post");
    expect(readHostMessage(effect.message)).toEqual({ kind: "render", module: frame.module });
  });

  test("clamps a reported size", () => {
    expect(canvasFrameEffects(shellMessage(sizeChangedNotification(12)), frame)).toEqual([
      { kind: "height", height: CANVAS_MIN_HEIGHT },
    ]);
    expect(canvasFrameEffects(shellMessage(sizeChangedNotification(640)), frame)).toEqual([
      { kind: "height", height: 640 },
    ]);
  });

  test("hands a link request and an error to the frame", () => {
    expect(
      canvasFrameEffects(shellMessage(openLinkRequest("link-1", "https://nyte.sh/")), frame),
    ).toEqual([{ kind: "open-link", id: "link-1", url: "https://nyte.sh/" }]);
    expect(
      canvasFrameEffects(
        shellMessage(errorNotification({ phase: "render", message: "x is not defined" })),
        frame,
      ),
    ).toEqual([{ kind: "error", phase: "render", message: "x is not defined" }]);
  });

  test("ignores what is not a shell message", () => {
    expect(readShellMessage({ type: "resize", height: 100 })).toBeUndefined();
    expect(readShellMessage(openLinkRequest("link-2", "javascript:alert(1)"))).toBeUndefined();
  });
});
