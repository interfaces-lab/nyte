import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin, Session } from "@nyte-ai/core";
import { memoryStore } from "@nyte-ai/core/store";
import { asId } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/schema";
import { afterEach, assert, expect, it } from "vitest";
import { fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import { localProvider, openHost } from "@nyte-ai/host";
import plan from "../index.ts";

const PLAN_MODE = "mode.plan";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function createPlan(id: string, name: string) {
  return {
    content: [
      {
        type: "toolCall" as const,
        id,
        name: "create_plan",
        arguments: { name, overview: `${name}.`, plan: `# ${name}`, todos: ["First", "Second"] },
      },
    ],
  };
}

function say(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function trays(view: SessionView) {
  return view.parts.filter((part) => part.partKind === "plan-tray");
}

function cards(view: SessionView) {
  return view.messages.flatMap((message) =>
    message.kind === "part" && message.partKind === "plan" ? [message] : [],
  );
}

function buildMessages(view: SessionView) {
  return view.messages.flatMap((message) =>
    message.kind === "user" && message.source.kind === "action" ? [message] : [],
  );
}

function planMode(view: SessionView): boolean {
  return view.configuration.effective?.settings[PLAN_MODE] === true;
}

const refuseActionSend: Plugin<"core"> = {
  id: "refuse-action-send",
  hooks: {
    before_send: (submission) =>
      submission.source.kind === "action"
        ? { action: "reject", reason: "Not right now." }
        : { action: "continue" },
  },
};

interface PlanCase {
  readonly name: string;
  readonly plugins?: readonly Plugin<"core">[];
  readonly stopCreatingRun?: true;
  readonly check: (context: {
    readonly session: Session;
    readonly fake: FakeModels;
  }) => Promise<void>;
}

const cases: readonly PlanCase[] = [
  {
    name: "a later turn keeps the tray",
    async check({ session, fake }) {
      const alpha = trays(await session.view())[0];
      assert(alpha !== undefined);
      expect(alpha.state).toMatchObject({ name: "Alpha", todos: 2, done: 0 });

      fake.reply(say("Noted."));
      await (await session.send("Thanks.")).settled();
      expect(trays(await session.view()).map((part) => part.id)).toEqual([alpha.id]);
    },
  },
  {
    name: "a newer plan replaces the tray with the newest one",
    async check({ session, fake }) {
      fake.reply(createPlan("b", "Beta"), say("Plan ready."));
      await (await session.send("Plan another.")).settled();

      const current = trays(await session.view());
      expect(current).toHaveLength(1);
      expect(current[0]?.state).toMatchObject({ name: "Beta", todos: 2, done: 0 });
      expect(current[0]?.status.kind).toBe("live");
    },
  },
  {
    name: "Dismiss closes the tray and leaves the card unbuilt",
    async check({ session }) {
      const alpha = trays(await session.view())[0];
      assert(alpha !== undefined);

      expect((await session.part(alpha.id).act("dismiss", {})).kind).toBe("closed");

      const view = await session.view();
      expect(trays(view)).toEqual([]);
      expect(cards(view).at(-1)?.state).toMatchObject({ name: "Alpha", built: false });
    },
  },
  {
    name: "Build from the tray queues one action message, marks the card built, closes the tray, and turns plan.mode off, which its request is told",
    async check({ session, fake }) {
      const before = await session.view();
      const tray = trays(before)[0];
      const card = cards(before).at(-1);
      assert(tray !== undefined && card !== undefined);

      fake.reply(say("Built."));
      expect((await session.part(tray.id).act("build", {})).kind).toBe("closed");
      expect(
        await session.receipt(asId<"receipt">(`plan-build-${card.part}`)).settled(),
      ).toMatchObject({ kind: "completed" });

      const after = await session.view();
      const builds = buildMessages(after);
      expect(builds).toHaveLength(1);
      expect(builds[0]?.source).toEqual({ kind: "action", label: "Build plan: Alpha" });
      expect(cards(after).at(-1)?.state).toMatchObject({ name: "Alpha", built: true });
      expect(trays(after)).toEqual([]);
      expect(planMode(after)).toBe(false);

      const told = (fake.requests.at(-1)?.context.messages ?? []).flatMap((message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith("<system-reminder>")
          ? [message.content.split("\n")[1]]
          : [],
      );

      expect(told).toEqual([
        "Plan mode is on.",
        "Plan mode is off. Its instructions no longer apply.",
      ]);
    },
  },
  {
    name: "Build a second time from the card adds no second message and does not touch plan.mode",
    async check({ session, fake }) {
      const before = await session.view();
      const tray = trays(before)[0];
      const card = cards(before).at(-1);
      assert(tray !== undefined && card !== undefined);

      fake.reply(say("Built."));
      expect((await session.part(tray.id).act("build", {})).kind).toBe("closed");
      await session.receipt(asId<"receipt">(`plan-build-${card.part}`)).settled();

      expect(await session.configure({ settings: { [PLAN_MODE]: true } })).toMatchObject({
        kind: "configured",
      });
      expect(await session.part(card.part).act("build", {})).toEqual({
        kind: "ok",
        output: undefined,
      });

      const after = await session.view();
      expect(buildMessages(after)).toHaveLength(1);
      expect(planMode(after)).toBe(true);
    },
  },
  {
    name: "stopping the run that created the plan leaves the tray live",
    stopCreatingRun: true,
    async check({ session }) {
      const view = await session.view();
      const current = trays(view);
      expect(current).toHaveLength(1);
      expect(current[0]?.status.kind).toBe("live");
      expect(current[0]?.state).toMatchObject({ name: "Alpha", todos: 2, done: 0 });
      expect(cards(view).at(-1)?.state).toMatchObject({ name: "Alpha", built: false });
    },
  },
  {
    name: "a Build refused by before_send leaves the card unbuilt and the tray open",
    plugins: [refuseActionSend],
    async check({ session }) {
      const before = await session.view();
      const tray = trays(before)[0];
      assert(tray !== undefined);

      expect(await session.part(tray.id).act("build", {})).toEqual({
        kind: "rejected",
        reason: "Not right now.",
      });

      const after = await session.view();
      expect(buildMessages(after)).toEqual([]);
      expect(cards(after).at(-1)?.state).toMatchObject({ name: "Alpha", built: false });
      expect(trays(after).map((part) => part.id)).toEqual([tray.id]);
      expect(trays(after)[0]?.status.kind).toBe("live");
      expect(planMode(after)).toBe(true);
    },
  },
];

it.each(cases)(
  "plan tray lifecycle: $name",
  async (row) => {
    const home = await mkdtemp(join(tmpdir(), "nyte-plan-tray-"));
    folders.push(home);
    const fake = fakeModels();

    await using host = await openHost({
      store: memoryStore(),
      models: fake.models,
      plugins: [
        { id: "local", environment: localProvider({ home }) },
        plan,
        ...(row.plugins ?? []),
      ],
      workspace: { kind: "local", path: home },
      home,
    });

    const workspace = (await host.workspaces.list())[0];
    assert(workspace !== undefined);

    const created = Promise.withResolvers<void>();

    if (row.stopCreatingRun) {
      fake.reply(createPlan("a", "Alpha"), (request) => {
        created.resolve();
        const aborted = Promise.withResolvers<void>();
        request.options?.signal?.addEventListener("abort", () => aborted.resolve(), { once: true });

        return { content: [{ type: "text", text: "Plan ready." }], until: aborted.promise };
      });
    } else {
      fake.reply(createPlan("a", "Alpha"), say("Plan ready."));
    }

    const started = await host.sessions.start({
      workspace: workspace.id,
      name: "Plans",
      content: "Plan it.",
      configuration: { settings: { [PLAN_MODE]: true } },
    });

    if (row.stopCreatingRun) {
      await created.promise;
      await started.session.stop();
      expect(await started.receipt.settled()).toEqual({ kind: "stopped" });
    } else {
      await started.receipt.settled();
    }

    await row.check({ session: started.session, fake });
  },
  60_000,
);
