import type { ClientApi } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import notifications from "../src/client/notifications.ts";
import { clientApi } from "./client-api.ts";
import { fakeModels, open } from "./fake-models.ts";

it("notifies once when a root session's run fails and stays quiet for a stop or a child", async () => {
  await using host = await open(fakeModels(), []);
  const { session: root } = await host.sessions.start({ content: "Hi." });
  await root.update({ name: "Release" });
  const { session: child } = await host.sessions.start({ parent: root.id, content: "Hi." });
  const notified: Parameters<ClientApi["ui"]["notify"]>[0][] = [];
  const api = clientApi(host, notified);
  const handler = notifications.hooks.run_ended_anywhere;
  const context = {
    api,
    signal: new AbortController().signal,
    session: null,
    head: null,
    run: null,
  };
  const failed = {
    kind: "failed",
    failure: { class: "provider", message: "Rate\nlimited." },
  } as const;

  await handler({ session: root.id, run: asId("r1"), end: failed }, context);
  await handler({ session: root.id, run: asId("r3"), end: { kind: "stopped" } }, context);
  await handler({ session: child.id, run: asId("r2"), end: { kind: "stopped" } }, context);

  expect(notified).toEqual([
    { title: "Release", message: "Run failed: Rate limited.", level: "error" },
  ]);
});

it("stays quiet for every session someone is looking at, in either pane", async () => {
  await using host = await open(fakeModels(), []);
  const shown = (await host.sessions.start({ content: "Hi." })).session;
  const beside = (await host.sessions.start({ content: "Hi." })).session;
  const behind = (await host.sessions.start({ content: "Hi." })).session;
  const notified: Parameters<ClientApi["ui"]["notify"]>[0][] = [];
  const api = { ...clientApi(host, notified), looking: new Set([shown.id, beside.id]) };
  const handler = notifications.hooks.run_ended_anywhere;

  const context = {
    api,
    signal: new AbortController().signal,
    session: null,
    head: null,
    run: null,
  };

  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  const completed = { kind: "completed", usage } as const;

  await handler({ session: shown.id, run: asId("r1"), end: completed }, context);
  await handler({ session: beside.id, run: asId("r2"), end: completed }, context);
  await handler({ session: behind.id, run: asId("r3"), end: completed }, context);

  expect(notified).toEqual([{ title: "New chat", message: "Run finished", level: "info" }]);
});
