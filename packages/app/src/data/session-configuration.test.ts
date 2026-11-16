import { MutationObserver } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { asId, asSeq } from "@nyte-ai/schema";
import type { ConfigureOutcome, ModelRef, SessionView } from "@nyte-ai/sdk";
import { startSideChat } from "../chat/side-chat/side-chats.ts";
import { chatStore } from "./chat-store.ts";
import { queryClient } from "./query-client.ts";
import {
  pendingConfigurations,
  projectSessionChoice,
  sessionConfigurationOptions,
} from "./session-configuration.ts";
import type { ConfigureSessionPatch } from "./session-configuration.ts";
import { installScripted, scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import { sessionView } from "../../test/view-fixtures.ts";

const OLD: ModelRef = { provider: "test", id: "old" };

const NEW: ModelRef = { provider: "test", id: "new" };

function chosen(seq: number, model: ModelRef): SessionView {
  return sessionView({
    seq: asSeq(seq),
    configuration: {
      selected: {
        kind: "exact",
        model,
        thinking: "off",
        agent: null,
        settings: {},
        settingsVersion: "1",
      },
      effective: null,
    },
  });
}

const CONFIGURED: ConfigureOutcome = {
  kind: "configured",
  selected: {
    kind: "exact",
    model: NEW,
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  },
  revision: asId<"revision">("r9"),
};

let sessions = 0;

async function picked(configure: (patch: ConfigureSessionPatch) => Promise<ConfigureOutcome>) {
  sessions += 1;
  const session = asId<"session">(`configured-${String(sessions)}`);
  const views = viewStream<SessionView>(chosen(1, OLD));
  const started: { configuration: unknown }[] = [];

  const scripted = scriptedConnection({
    views: new Map([[session, views]]),
    session: () => ({ configure }),
  });

  installScripted({
    connection: {
      ...scripted.connection,
      sessions: {
        ...scripted.connection.sessions,
        start: async (input) => {
          started.push({ configuration: input.configuration });

          throw new Error("Not started.");
        },
      },
    },
  });

  const store = chatStore(session);
  const leave = store.subscribe(() => undefined);
  await store.until(() => true);

  const mutation = new MutationObserver(
    queryClient,
    sessionConfigurationOptions({ sessionId: session }),
  );

  const done = mutation.mutate({ model: NEW }).then(
    () => "done",
    (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  );

  const shown = (): string | undefined => {
    const value = store.value;

    return value === undefined
      ? undefined
      : projectSessionChoice(value, pendingConfigurations(session)).model?.id;
  };

  return { session, views, store, leave, done, shown, started };
}

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

test.each<{
  readonly name: string;
  readonly steps: readonly ("answer" | "unrelated view" | "chosen view" | "picked back" | "2 s")[];
  readonly shown: string;
  readonly pending: number;
}>([
  {
    name: "an unrelated view landing before the answer keeps the new model shown",
    steps: ["unrelated view", "answer"],
    shown: "new",
    pending: 1,
  },
  {
    name: "the view that shows the new model ends the wait",
    steps: ["answer", "unrelated view", "chosen view"],
    shown: "new",
    pending: 0,
  },
  {
    name: "a view already showing the new model at the answer ends the wait at once",
    steps: ["chosen view", "answer"],
    shown: "new",
    pending: 0,
  },
  {
    name: "a chat that never shows the new model drops the choice after 2 s",
    steps: ["answer", "unrelated view", "2 s"],
    shown: "old",
    pending: 0,
  },
  {
    name: "picking the old model back once the new one is answered shows the old model",
    steps: ["answer", "picked back"],
    shown: "old",
    pending: 0,
  },
])("$name", async (row) => {
  vi.useFakeTimers();
  const answer = Promise.withResolvers<ConfigureOutcome>();

  const chat = await picked(async (patch) =>
    patch.model?.id === OLD.id
      ? { ...CONFIGURED, selected: { ...CONFIGURED.selected, model: OLD } }
      : answer.promise,
  );

  for (const step of row.steps) {
    if (step === "answer") answer.resolve(CONFIGURED);

    if (step === "picked back")
      void new MutationObserver(
        queryClient,
        sessionConfigurationOptions({ sessionId: chat.session }),
      )
        .mutate({ model: OLD })
        .catch(() => undefined);

    if (step === "unrelated view") chat.views.push(chosen(2, OLD));

    if (step === "chosen view") chat.views.push(chosen(3, NEW));
    await settle(step === "2 s" ? 2_000 : 0);
  }

  expect({ shown: chat.shown(), pending: pendingConfigurations(chat.session).length }).toEqual({
    shown: row.shown,
    pending: row.pending,
  });
  await settle(2_000);
  chat.leave();
  await settle();
  vi.useRealTimers();
  queryClient.getMutationCache().clear();
});

test("a configure that fails leaves nothing watching the chat", async () => {
  vi.useFakeTimers();

  const chat = await picked(async () => {
    throw new Error("Network down.");
  });

  expect(await chat.done).toBe("Network down.");
  chat.leave();
  await settle();

  expect(chat.store.active).toBe(false);
  vi.useRealTimers();
  queryClient.getMutationCache().clear();
});

test("a side chat started while a model change is in flight starts on the new model", async () => {
  const answer = Promise.withResolvers<ConfigureOutcome>();
  const chat = await picked(() => answer.promise);

  await startSideChat(chat.session, "Why?");

  expect(chat.started).toEqual([{ configuration: { model: NEW, thinking: "off" } }]);
  answer.resolve(CONFIGURED);
  chat.views.push(chosen(3, NEW));
  await chat.done;
  chat.leave();
  queryClient.getMutationCache().clear();
});
