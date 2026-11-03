import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import process from "node:process";
import { afterEach, test, vi } from "vitest";
import { PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { isPart, tool } from "@nyte-ai/plugin/core";
import { clientBrowserPlugins } from "@nyte-ai/plugin/core/browser-client";
import { canvasPlugin } from "@nyte-ai/plugin/core/canvas";
import { clientCanvasPreview } from "@nyte-ai/plugin/core/canvas-client";
import type { CanvasPreviewer } from "@nyte-ai/plugin/core/canvas-preview";
import { KIT_SPECIFIER } from "@nyte-ai/plugin/canvas/protocol";
import type { SessionView } from "@nyte-ai/sdk";
import type {
  BrowserActionResult,
  BrowserAgent,
  BrowserOwner,
  BrowserPageState,
} from "../shared/browser-agent.ts";
import { offerAppActions } from "../shared/host-client.ts";
import { testDesktop } from "./fixtures/desktop-host.ts";
import type { TestDesktop } from "./fixtures/desktop-host.ts";

const opened: TestDesktop[] = [];

afterEach(async () => {
  for (const desktop of opened.splice(0)) await desktop.close();
});

const PNG = Uint8Array.fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
);

const chromium: CanvasPreviewer = async () => ({
  kind: "unavailable",
  reason: "Chromium is not installed.",
});

async function desktop(): Promise<TestDesktop> {
  const made = await testDesktop(
    {},
    {
      clientPlugins: (actions) => [
        ...clientBrowserPlugins(actions, process.cwd()),
        canvasPlugin(clientCanvasPreview(actions, chromium)),
      ],
    },
  );
  opened.push(made);
  await made.served.settings.apply(PERMISSIONS, "full");

  return made;
}

async function offered(made: TestDesktop): Promise<void> {
  await vi.waitFor(
    async () => {
      const rows = await made.client.call("clients.read", {});
      assert.ok(rows.some((row) => row.actions.some((action) => action.name === "browser")));
    },
    { timeout: 5_000 },
  );
}

function page(overrides: Partial<BrowserPageState> = {}): BrowserPageState {
  return {
    url: "https://example.test/",
    title: "Example",
    loading: false,
    snapshot: 1,
    viewport: { width: 800, height: 600 },
    scroll: { y: 0, height: 600 },
    nodes: [
      {
        ref: "s1e1",
        role: "button",
        name: "Sign\nin",
        tag: "button",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    totalNodes: 1,
    text: "",
    blocked: 0,
    error: undefined,
    ...overrides,
  };
}

function recordingAgent() {
  const calls: { verb: string; input: unknown }[] = [];
  const ok = (state = page()): BrowserActionResult => ({ kind: "ok", state });

  const fail = (): never => {
    throw new Error("This browser call is not expected here");
  };

  const agent: BrowserAgent = {
    open: async (input) => {
      calls.push({ verb: "open", input });

      return ok();
    },
    snapshot: async (input) => {
      calls.push({ verb: "snapshot", input });

      return ok(page({ snapshot: 2 }));
    },
    click: async (input) => {
      calls.push({ verb: "click", input });

      return {
        kind: "failed",
        failure: { kind: "occluded", ref: input.ref, by: { role: "dialog", name: "Cookies" } },
      };
    },
    type: fail,
    press: fail,
    scroll: fail,
    wait: fail,
    console: fail,
    evaluate: fail,
    capture: fail,
    release: () => undefined,
    sessionSurfaceId: (session) => `stage:session:${session}`,
  };

  return { agent, calls };
}

function toolResults(view: SessionView): { readonly name: string; readonly text: string }[] {
  return view.messages.flatMap((message) => {
    if (!isPart(message, tool) || message.state.phase !== "settled") return [];

    return [{ name: message.state.name, text: JSON.stringify(message.state.outcome) }];
  });
}

test("the browser tools drive the session's page through the app that offers the browser", async () => {
  const made = await desktop();
  const recording = recordingAgent();
  offerAppActions(made.client, {
    agent: recording.agent,
    preview: chromium,
    signal: () => new AbortController().signal,
  });
  await offered(made);

  made.fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "browser_open",
          arguments: { url: "https://example.test/" },
        },
      ],
      stopReason: "toolUse",
    },
    {
      content: [
        { type: "toolCall", id: "call-2", name: "browser_click", arguments: { ref: "s1e1" } },
      ],
      stopReason: "toolUse",
    },
    { content: [{ type: "text", text: "done" }] },
  );

  const started = await made.served.sessions.start({
    name: "browse",
    content: "Open the page and sign in",
  });

  await started.receipt.settled();
  const results = toolResults(await started.session.view());

  const owner: BrowserOwner = { kind: "home" };
  assert.deepEqual(recording.calls[0], {
    verb: "open",
    input: {
      method: "open",
      session: started.session.sessionId,
      owner,
      url: "https://example.test/",
    },
  });
  assert.ok(recording.calls.some((call) => call.verb === "click"));
  assert.equal(results.length, 2);
  assert.match(results[0]?.text ?? "", /Example/);
  assert.match(results[0]?.text ?? "", /\[s1e1\] button \\"Signin\\"/);
  assert.match(results[1]?.text ?? "", /occluded/);
});

test("with no app offering the browser, a browser tool answers that only Nyte.app has it", async () => {
  const made = await desktop();

  made.fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "browser_open",
          arguments: { url: "https://example.test/" },
        },
      ],
      stopReason: "toolUse",
    },
    { content: [{ type: "text", text: "done" }] },
  );

  const started = await made.served.sessions.start({ name: "browse", content: "Open the page" });
  await started.receipt.settled();

  assert.match(
    toolResults(await started.session.view())[0]?.text ?? "",
    /The browser isn't available here: this chat uses browser-tools, which only Nyte\.app has\. Open Nyte\.app to continue\./,
  );
});

test("a canvas preview renders in the app that offers it, its screenshot crossing the socket whole", async () => {
  const made = await desktop();
  const themes: string[] = [];

  offerAppActions(made.client, {
    agent: recordingAgent().agent,
    preview: async (request) => {
      themes.push(request.theme);

      return {
        kind: "rendered",
        report: {
          png: PNG,
          heights: { chat: 312, phone: 640 },
          errors: [],
          console: [{ level: "log", text: "hi" }],
        },
      };
    },
    signal: () => new AbortController().signal,
  });
  await offered(made);

  made.fake.reply(
    {
      content: [
        {
          type: "toolCall",
          id: "p1",
          name: "canvas_preview",
          arguments: {
            source: `import { Text } from "${KIT_SPECIFIER}";\nexport default () => <Text>Hi</Text>;`,
            theme: "dark",
          },
        },
      ],
      stopReason: "toolUse",
    },
    { content: [{ type: "text", text: "Looks right." }] },
  );

  const started = await made.served.sessions.start({ name: "preview", content: "Preview it." });
  await started.receipt.settled();

  assert.deepEqual(themes, ["dark"]);
  const result = made.fake.requests
    .at(-1)
    ?.context.messages.find((message) => message.role === "toolResult");

  assert.ok(result?.role === "toolResult");
  const texts = result.content.map((part) => (part.type === "text" ? part.text : ""));
  assert.match(texts[0] ?? "", /At 808 px wide \(the chat column\) it is 312 px tall\./);
  assert.equal(
    texts[1],
    `[File ${createHash("sha256").update(PNG).digest("hex")}, ${PNG.byteLength} bytes, image/png]`,
  );
});
