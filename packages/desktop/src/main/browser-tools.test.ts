import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { isPart, tool } from "@nyte-ai/plugin/core";
import type { SessionView } from "@nyte-ai/sdk";
import type {
  BrowserActionResult,
  BrowserAgent,
  BrowserOwner,
  BrowserPageState,
} from "./browser-agent.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { testDesktop } from "./fixtures/desktop-host.ts";
import type { TestDesktop } from "./fixtures/desktop-host.ts";

const opened: TestDesktop[] = [];

afterEach(async () => {
  for (const desktop of opened.splice(0)) await desktop.close();
});

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

  const agent: BrowserAgent = {
    ...unusedBrowserAgent(),
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

test("the browser tools drive the session's page through the desktop agent", async () => {
  const { agent, calls } = recordingAgent();
  const made = await testDesktop({ agent });
  opened.push(made);
  const host = await made.host.host();

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

  const { session, receipt } = await host.sessions.start({
    name: "browse",
    content: "Open the page and sign in",
  });

  await receipt.settled();
  const results = toolResults(await session.view());

  const owner: BrowserOwner = { kind: "home" };
  assert.deepEqual(calls[0], {
    verb: "open",
    input: { session: session.sessionId, owner, url: "https://example.test/" },
  });
  assert.ok(calls.some((call) => call.verb === "click"));
  assert.equal(results.length, 2);
  assert.match(results[0]?.text ?? "", /Example/);
  assert.match(results[0]?.text ?? "", /\[s1e1\] button \\"Signin\\"/);
  assert.match(results[1]?.text ?? "", /occluded/);
});
