import assert from "node:assert/strict";
import { test } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { sessionId } from "@nyte-ai/protocol";
import type { Selection, SelectionReply, SessionSnapshot } from "@nyte-ai/core";
import { acceptsReply, parkedSelections, selectionReplyOptions } from "./selection.ts";
import type { NyteBridge } from "../../../shared/ipc.ts";

const selection: Selection = {
  title: "Which implementation?",
  choices: [
    { id: "1", label: "Small patch", description: "Change one owner" },
    { id: "2", label: "Broad rewrite" },
  ],
  other: "Or type your own answer",
};
const call = {
  runId: "run-1",
  callId: "call-1",
  waitId: "wait-1",
  selection,
  until: 500,
};

function observeReply(reply: NyteBridge["runs"]["reply"], refresh = async () => {}) {
  const client = new QueryClient();
  const observer = new MutationObserver(
    client,
    selectionReplyOptions({ sessionId: sessionId("chat-1"), call, reply, refresh }),
  );
  const unsubscribe = observer.subscribe(() => {});
  return {
    observer,
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
}

test("restores every parked selection from the snapshot; background waits are not selections", () => {
  const parked: SessionSnapshot["parked"] = [
    {
      runId: "run-1",
      callId: "call-1",
      waitId: "wait-1",
      tool: "question",
      args: {},
      selection,
      until: 500,
    },
    {
      runId: "run-1",
      callId: "task",
      waitId: "wait-task",
      tool: "task",
      args: { model: "fixture/script", prompt: "Investigate" },
    },
    {
      runId: "run-2",
      callId: "call-2",
      waitId: "wait-2",
      tool: "websearch",
      args: { query: "q" },
      selection,
    },
  ];
  assert.deepEqual(
    parkedSelections(parked).map((item) => [
      item.runId,
      item.callId,
      item.waitId,
      item.selection.title,
      item.until,
    ]),
    [
      ["run-1", "call-1", "wait-1", "Which implementation?", 500],
      ["run-2", "call-2", "wait-2", "Which implementation?", undefined],
    ],
  );
  assert.deepEqual(parkedSelections(undefined), []);
  assert.deepEqual(parkedSelections([]), []);
});

test("reply validation enforces ids, cardinality, custom text, and duplicate choices", () => {
  assert.equal(acceptsReply(selection, { choices: ["1"] }), true);
  assert.equal(acceptsReply(selection, { choices: [], other: "Wait for the migration" }), true);
  assert.equal(acceptsReply(selection, { choices: [] }), false);
  assert.equal(acceptsReply(selection, { choices: ["1", "2"] }), false);
  assert.equal(acceptsReply(selection, { choices: ["1", "1"] }), false);
  assert.equal(acceptsReply(selection, { choices: ["3"] }), false);
  assert.equal(acceptsReply(selection, { choices: [], other: "   " }), false);
  assert.equal(acceptsReply(selection, { choices: ["1"], other: "also" }), false);

  const choiceOnly: Selection = { title: selection.title, choices: selection.choices };
  assert.equal(acceptsReply(choiceOnly, { choices: ["2"] }), true);
  assert.equal(acceptsReply(choiceOnly, { choices: [], other: "Broad rewrite" }), false);

  const multiple: Selection = { ...selection, multiple: true };
  assert.equal(acceptsReply(multiple, { choices: ["1", "2"] }), true);
  assert.equal(acceptsReply(multiple, { choices: ["1"], other: "plus tests" }), true);
});

const replies: readonly SelectionReply[] = [
  { choices: ["1"] },
  { choices: ["2"] },
  { choices: [], other: "my own answer" },
];

test.each(replies)("sends a structured reply to its session, run, and call", async (reply) => {
  const received: Parameters<NyteBridge["runs"]["reply"]>[0][] = [];
  const f = observeReply(async (input) => {
    received.push(input);
    return { kind: "signalled" };
  });
  try {
    assert.deepEqual(await f.observer.mutate(reply), { kind: "signalled" });
    const normalized =
      reply.other === undefined ? reply : { choices: reply.choices, other: reply.other.trim() };
    assert.deepEqual(received, [
      {
        sessionId: sessionId("chat-1"),
        runId: "run-1",
        callId: "call-1",
        waitId: "wait-1",
        reply: normalized,
      },
    ]);
    assert.equal(f.observer.getCurrentResult().isSuccess, true);
  } finally {
    f.close();
  }
});

test("a blank reply never leaves the client", async () => {
  const received: string[] = [];
  const f = observeReply(async () => {
    received.push("reply");
    return { kind: "signalled" };
  });
  try {
    await assert.rejects(f.observer.mutate({ choices: [], other: " " }), /offered answers/);
    assert.deepEqual(received, []);
    assert.equal(f.observer.getCurrentResult().isError, true);
  } finally {
    f.close();
  }
});

test("stays pending until the accepted reply and its refresh finish", async () => {
  const response = Promise.withResolvers<Awaited<ReturnType<NyteBridge["runs"]["reply"]>>>();
  const refreshed = Promise.withResolvers<void>();
  const f = observeReply(
    () => response.promise,
    () => refreshed.promise,
  );
  try {
    const result = f.observer.mutate({ choices: ["1"] });
    assert.equal(f.observer.getCurrentResult().isPending, true);
    response.resolve({ kind: "signalled" });
    await Promise.resolve();
    assert.equal(f.observer.getCurrentResult().isPending, true);
    refreshed.resolve();
    await result;
    assert.equal(f.observer.getCurrentResult().isSuccess, true);
  } finally {
    f.close();
  }
});

test.each(["not_waiting", "not_found"] as const)(
  "refreshes stale %s replies without claiming the answer was sent",
  async (kind) => {
    let refreshed = false;
    const f = observeReply(
      async () => ({ kind }),
      async () => {
        refreshed = true;
      },
    );
    try {
      assert.deepEqual(await f.observer.mutate({ choices: ["2"] }), { kind });
      assert.equal(refreshed, true);
    } finally {
      f.close();
    }
  },
);

test("a refresh failure does not turn an accepted reply into a failed reply", async () => {
  const f = observeReply(
    async () => ({ kind: "signalled" }),
    async () => {
      throw new Error("Snapshot unavailable");
    },
  );
  try {
    assert.deepEqual(await f.observer.mutate({ choices: ["1"] }), { kind: "signalled" });
    assert.equal(f.observer.getCurrentResult().isSuccess, true);
  } finally {
    f.close();
  }
});

test("transport failures refresh the snapshot and allow an explicit retry", async () => {
  let online = false;
  let refreshed = false;
  const f = observeReply(
    async () => {
      if (!online) throw new Error("Host disconnected");
      return { kind: "signalled" };
    },
    async () => {
      refreshed = true;
    },
  );
  try {
    await assert.rejects(f.observer.mutate({ choices: ["2"] }), /Host disconnected/);
    assert.equal(f.observer.getCurrentResult().isError, true);
    assert.equal(refreshed, true);
    online = true;
    assert.deepEqual(await f.observer.mutate({ choices: ["2"] }), { kind: "signalled" });
  } finally {
    f.close();
  }
});
