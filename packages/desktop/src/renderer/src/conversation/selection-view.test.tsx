import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionSnapshot } from "@nyte-ai/core";
import { Selections } from "./selection.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: {} }));
afterAll(() => vi.unstubAllGlobals());

const id = sessionId("chat");
const until = Date.now() + 65_000;
const parked: SessionSnapshot["parked"] = [
  {
    runId: "run",
    callId: "call",
    waitId: "wait-call",
    tool: "question",
    args: {},
    until,
    selection: {
      title: "Which <script>implementation</script>?",
      choices: [
        { id: "small patch", label: "Small patch", description: "Change one owner" },
        { id: "2", label: "Broad rewrite" },
      ],
      multiple: true,
      other: "Or type your own answer",
    },
  },
  {
    runId: "run",
    callId: "consent",
    waitId: "wait-consent",
    tool: "websearch",
    args: { query: "q" },
    selection: {
      title: "Allow anonymous web search?",
      choices: [
        { id: "auto", label: "Allow automatic search", description: "No key" },
        { id: "off", label: "Off", description: "Do not search" },
      ],
    },
  },
  {
    runId: "run",
    callId: "task",
    waitId: "wait-task",
    tool: "task",
    args: { model: "fixture/script", prompt: "Investigate" },
  },
];

function render(client: QueryClient, calls = parked, disabled = false) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Selections sessionId={id} parked={calls} disabled={disabled} />
    </QueryClientProvider>,
  );
}

function assertChoices(html: string, labels: readonly string[], disabled: boolean) {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  for (const label of labels) {
    const button = buttons.find((match) => match[1]?.includes(`aria-label="${label}"`));
    assert.ok(button, `Missing choice: ${label}`);
    assert.ok(button[2]?.replace(/<[^>]*>/g, "").includes(label));
    const description = button[1]?.match(/aria-describedby="([^"]+)"/)?.[1];
    if (description !== undefined) {
      assert.doesNotMatch(description, /\s/, `Unsafe description id for ${label}`);
      assert.ok(html.includes(`id="${description}"`), `Missing description target for ${label}`);
    }
    assert.equal(/\sdisabled(?:\s|=|$)/.test(button[1] ?? ""), disabled, label);
  }
}

test("a restored snapshot renders every selection from its own words, escaped", () => {
  const client = new QueryClient();
  try {
    const html = render(client);
    const text = html.replace(/<[^>]*>/g, "");
    assert.match(html, /Which &lt;script&gt;implementation&lt;\/script&gt;\?/);
    assert.doesNotMatch(html, /<script\b/);
    assert.ok(text.includes("Allow anonymous web search?"));
    assertChoices(html, ["Small patch", "Broad rewrite", "Allow automatic search", "Off"], false);
    assert.match(text, /Change one owner/);
    assert.match(text, /Do not search/);
    assert.match(text, /Closes in 1m/);
    assert.doesNotMatch(html, /role="status"/);
    assert.match(html, /aria-pressed="false"/);
    assert.doesNotMatch(text, /general/);
    assert.doesNotMatch(render(client, []), /implementation/);
  } finally {
    client.clear();
  }
});

test("an input appears only where the selection allows another answer", () => {
  const client = new QueryClient();
  try {
    const html = render(client);
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)];
    assert.equal(inputs.length, 1);
    assert.match(inputs[0]?.[0] ?? "", /placeholder="Or type your own answer"/);
  } finally {
    client.clear();
  }
});

test("a multiple selection renders one submit action and marks choices as toggles", () => {
  const client = new QueryClient();
  try {
    const first = parked?.[0];
    assert.ok(first);
    const html = render(client, [first]);
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2);
    assert.equal((html.match(/>Answer<\/button>/g) ?? []).length, 1);
  } finally {
    client.clear();
  }
});

test("an unhealthy snapshot cannot send an answer", () => {
  const client = new QueryClient();
  try {
    const html = render(client, parked, true);
    assertChoices(html, ["Small patch", "Broad rewrite", "Allow automatic search", "Off"], true);
    assert.match(html.match(/<input\b[^>]*>/)?.[0] ?? "", /\sdisabled/);
  } finally {
    client.clear();
  }
});
