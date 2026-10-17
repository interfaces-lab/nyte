import { text } from "@nyte-ai/core";
import type { Plugin, Renderer } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { HeadInfo, RunEnd, SessionInfo } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { mountClientPlugins } from "../src/client/mount.ts";
import type { PartMessage } from "../src/client/presentation.ts";
import { fakeModels, open } from "./fake-models.ts";

function renderer(framework: string): Renderer {
  return { kind: text, framework, render: (part) => `${framework}:${JSON.stringify(part.state)}` };
}

const message: PartMessage = {
  id: asId("message"),
  turn: asId("turn"),
  at: 0,
  kind: "part",
  part: asId("part"),
  partKind: "text",
  role: "answer",
  state: { markdown: "hi" },
  version: 1,
  status: { kind: "live", run: null },
};

function ended(session: SessionInfo, run: string, end: RunEnd): SessionInfo {
  const heads = session.heads.map((head): HeadInfo => ({
    ...head,
    execution: { kind: "idle", lastRun: { id: asId(run), end, endedAt: 0 } },
  }));

  return { ...session, heads };
}

it("draws with the client's framework, reports run ends after the first list and asks before submit", async () => {
  await using host = await open(fakeModels(), []);
  const { session } = await host.sessions.start({ content: "Hi." });
  const [info] = (await host.sessions.list()).items;
  const ends: string[] = [];

  const plugin: Plugin<"client"> = {
    id: "probe",
    contribute: { renderers: [renderer("react"), renderer("tui")] },
    hooks: {
      run_ended_anywhere: (event) => void ends.push(`${event.run}:${event.end.kind}`),
      before_submit: (draft) =>
        draft.content === "stop" ? { action: "reject", reason: "no" } : { action: "continue" },
    },
  };

  const plugins = await mountClientPlugins({
    connection: host,
    plugins: [plugin],
    client: { name: "tui", frameworks: ["tui"] },
    session: () => session,
    notify: () => undefined,
    report: () => undefined,
  });

  expect(plugins.draw(session, message, { kind: "transcript", role: "note" })).toBe(
    'tui:{"markdown":"hi"}',
  );

  if (info === undefined) throw new Error("The host listed no session.");
  plugins.sessionsChanged([ended(info, "seen", { kind: "stopped" })]);
  plugins.sessionsChanged([ended(info, "seen", { kind: "stopped" })]);
  plugins.sessionsChanged([ended(info, "next", { kind: "stopped" })]);
  await Promise.resolve();

  expect(ends).toEqual(["next:stopped"]);
  expect(
    await plugins.beforeSubmit({ content: "stop", delivery: "queue", session: session.id }),
  ).toEqual({ action: "reject", reason: "no" });
  expect(await plugins.beforeSubmit({ content: "stop", delivery: "steer", session: null })).toEqual(
    { action: "reject", reason: "no" },
  );
  await plugins.dispose();
});
