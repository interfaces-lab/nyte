import type { ClientApi } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import notifications from "../src/notifications.ts";
import { clientApi } from "./client-api.ts";
import { fakeModels, open } from "./fake-models.ts";

it("notifies once when a root session's run ends and stays quiet for a child", async () => {
  await using host = await open(fakeModels(), []);
  const root = await host.sessions.create();
  await root.update({ name: "Release" });
  const child = await host.sessions.create({ parent: root.id });
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
  await handler({ session: child.id, run: asId("r2"), end: { kind: "stopped" } }, context);

  expect(notified).toEqual([
    { title: "Release", message: "Run failed: Rate limited.", level: "error" },
  ]);
});
