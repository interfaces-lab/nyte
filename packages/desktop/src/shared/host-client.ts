import { compile, idSchema, isJson, SdkError, SOCKET_LIMITS } from "@nyte-ai/schema";
import type { ActionDeclaration, Awaitable, Disposer, Json } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import type { ClientConnection, OpenSocket } from "@nyte-ai/sdk/client";
import { BROWSER_ACTION, BrowserCallType } from "@nyte-ai/plugin/core/browser-client";
import type { BrowserCall } from "@nyte-ai/plugin/core/browser-client";
import { CANVAS_PREVIEW_ACTION, CanvasPreviewCallType } from "@nyte-ai/plugin/core/canvas-client";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import { Type } from "typebox";
import WebSocket from "ws";
import type { BrowserAgent } from "./browser-agent.ts";

export const OPEN_ACTION = {
  name: "open",
  summary: "Opens a chat in this app and brings its window forward.",
  input: {
    type: "object",
    properties: { session: { type: "string" } },
    required: ["session"],
  },
} as const satisfies ActionDeclaration;

const openCalls = compile(Type.Object({ session: idSchema<"session">() }));

const FRAME_MARGIN = 64 * 1024;

const browserCalls = compile(BrowserCallType);

const previewCalls = compile(CanvasPreviewCallType);

export function appSocket(socket: string): OpenSocket {
  return (request) =>
    new WebSocket(`ws+unix://${socket}:${new URL(request.url).pathname}`, {
      headers: request.headers,
      maxPayload: SOCKET_LIMITS.maxFrameBytes,
    });
}

/**
 * Declares what the desktop process does for its host and answers requests for it. A request runs
 * when the host itself made it, as an agent's tool does, or when it comes from the principal this
 * app connected as. Any other is refused with `denied`.
 */
export function offerAppActions(
  connection: Pick<ClientConnection, "offer" | "principal">,
  app: {
    readonly agent: BrowserAgent;
    readonly preview: CanvasPreviewer;
    signal(): AbortSignal;
    openChat(session: SessionId): void;
  },
): Disposer {
  const offer = (action: ActionDeclaration, answer: (input: Json) => Awaitable<Json>): Disposer =>
    connection.offer(action, (input, requester) => {
      if (requester.client !== "host" && requester.principal !== connection.principal) {
        throw new SdkError("denied", "This app runs requests from its host and its own user only.");
      }

      return answer(input);
    });

  const stops = [
    offer(OPEN_ACTION, async (input) => {
      if (!openCalls.Check(input)) {
        throw new SdkError("invalid", "Name the chat to open as session.");
      }
      app.openChat(input.session);

      return { opened: true };
    }),
    offer(BROWSER_ACTION, async (input) => {
      if (!browserCalls.Check(input)) {
        throw new SdkError("invalid", "The host asked the browser for something unreadable.");
      }

      return answerBrowser(app.agent, input);
    }),
    offer(CANVAS_PREVIEW_ACTION, async (input) => {
      if (!previewCalls.Check(input)) {
        throw new SdkError("invalid", "The host asked for a canvas preview it did not describe.");
      }

      return previewAnswer(app.preview, input, app.signal());
    }),
  ];

  return () => {
    for (const stop of stops) stop();
  };
}

async function answerBrowser(agent: BrowserAgent, call: BrowserCall): Promise<Json> {
  switch (call.method) {
    case "open":
      return encode(await agent.open(call));
    case "snapshot":
      return encode(await agent.snapshot(call));
    case "click":
      return encode(await agent.click(call));
    case "type":
      return encode(await agent.type(call));
    case "press":
      return encode(await agent.press(call));
    case "scroll":
      return encode(await agent.scroll(call));
    case "wait":
      return encode(await agent.wait({ session: call.session, ...call.wait }));
    case "console":
      return encode(await agent.console(call));
    case "evaluate":
      return encode(await agent.evaluate(call));
    case "capture": {
      const bytes = await agent.capture(call);

      return bytes === undefined ? null : encode({ png: fitFrame(bytes) });
    }
    case "release":
      agent.release(call);

      return null;
    default: {
      const _exhaustive: never = call;

      return _exhaustive;
    }
  }
}

async function previewAnswer(
  preview: CanvasPreviewer,
  input: Parameters<CanvasPreviewer>[0],
  signal: AbortSignal,
): Promise<Json> {
  const outcome = await preview(input, signal);

  if (outcome.kind === "unavailable") return encode(outcome);

  return encode({
    kind: "rendered",
    report: { ...outcome.report, png: fitFrame(outcome.report.png) },
  });
}

function fitFrame(png: Uint8Array): string {
  const encoded = png.toBase64();

  if (encoded.length > SOCKET_LIMITS.maxFrameBytes - FRAME_MARGIN) {
    throw new SdkError("unavailable", "The screenshot is larger than the host's socket carries.");
  }

  return encoded;
}

function encode(value: unknown): Json {
  const encoded: unknown = JSON.parse(JSON.stringify(value) ?? "null");

  if (!isJson(encoded)) throw new SdkError("internal", "The app's answer did not encode as JSON.");

  return encoded;
}
