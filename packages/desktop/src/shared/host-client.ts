import { compile, isJson, SdkError, SOCKET_LIMITS } from "@nyte-ai/schema";
import type { Disposer, Json } from "@nyte-ai/schema";
import { openHost } from "@nyte-ai/sdk/client";
import type { HostConnection } from "@nyte-ai/sdk/client";
import { BROWSER_ACTION, BrowserCallType } from "@nyte-ai/plugin/core/browser-client";
import type { BrowserCall } from "@nyte-ai/plugin/core/browser-client";
import { CANVAS_PREVIEW_ACTION, CanvasPreviewCallType } from "@nyte-ai/plugin/core/canvas-client";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import WebSocket from "ws";
import type { BrowserAgent } from "./browser-agent.ts";
import { HOST_PORT_ORIGIN } from "./host-port.ts";

const FRAME_MARGIN = 64 * 1024;

const browserCalls = compile(BrowserCallType);

const previewCalls = compile(CanvasPreviewCallType);

/** Opens the app's client of the host on its local socket: the socket's peer is the host's owner, so it sends no credential. */
export function openAppClient(input: {
  readonly socket: string;
  readonly version: string;
}): HostConnection {
  return openHost(HOST_PORT_ORIGIN, {
    credentials: { kind: "custom", headers: () => ({}) },
    client: { kind: "app", name: "Nyte", version: input.version },
    socket: (request) =>
      new WebSocket(`ws+unix://${input.socket}:${new URL(request.url).pathname}`, {
        headers: request.headers,
        maxPayload: SOCKET_LIMITS.maxFrameBytes,
      }),
  });
}

/** Offers the host what only the app can do: drive each chat's page in its browser, and render canvas previews off-screen. */
export function offerAppActions(
  connection: Pick<HostConnection, "offer">,
  app: { readonly agent: BrowserAgent; readonly preview: CanvasPreviewer; signal(): AbortSignal },
): Disposer {
  const stops = [
    connection.offer(BROWSER_ACTION, async (input) => {
      if (!browserCalls.Check(input))
        throw new SdkError("invalid", "The host asked the browser for something unreadable.");

      return answerBrowser(app.agent, input);
    }),
    connection.offer(CANVAS_PREVIEW_ACTION, async (input) => {
      if (!previewCalls.Check(input))
        throw new SdkError("invalid", "The host asked for a canvas preview it did not describe.");

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

  if (encoded.length > SOCKET_LIMITS.maxFrameBytes - FRAME_MARGIN)
    throw new SdkError("unavailable", "The screenshot is larger than the host's socket carries.");

  return encoded;
}

function encode(value: unknown): Json {
  const encoded: unknown = JSON.parse(JSON.stringify(value) ?? "null");

  if (!isJson(encoded)) throw new SdkError("internal", "The app's answer did not encode as JSON.");

  return encoded;
}
