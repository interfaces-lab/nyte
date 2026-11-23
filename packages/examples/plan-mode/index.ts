import { posix } from "node:path";
import { definePart, isPart } from "@nyte-ai/core";
import type {
  ActionContext,
  ActionOutput,
  ExecutionEnv,
  PluginStorage,
  PromptSection,
  Session,
  SettingDefinition,
  ToolDefinition,
  When,
} from "@nyte-ai/core";
import { asId, SdkError, standard } from "@nyte-ai/schema";
import type { Awaitable, Infer, Json, Message, PartId, Schema, ToolContent } from "@nyte-ai/schema";
import type { HookHandler, Plugin } from "@nyte-ai/plugin/core";
import { Type } from "typebox";
import {
  planFileName,
  planState,
  PLANS_FOLDER,
  planTrayState,
  readTodos,
  trayState,
  writePlan,
} from "./plan-file.ts";
import type { PlanState, TrayState } from "./plan-file.ts";

const PLAN_MODE = "mode.plan";

const MAIN = asId<"head">("main");

const TRACKED_PREFIX = "plan:";

const HISTORY_PAGE_SIZE = 200;

const mode = {
  id: PLAN_MODE,
  title: "Plan",
  description: "Researches and writes an implementation plan before changing any code.",
  type: "switch",
  scope: "chat",
  mode: {
    icon: "plan",
    color: "oklch(0.75 0.166 64)",
  },
} satisfies SettingDefinition;

const on: When = (chat) => chat.settings[PLAN_MODE] === true;

const instructions = {
  id: PLAN_MODE,
  delivery: "reminder",
  when: on,
  text: `Plan mode is on.

Research the change and write an implementation plan; don't implement it.

- Read code and run read-only commands to understand the change. Edit only markdown files.
- Ask with the question tool only about decisions that change the plan, one or two at a time, each with the option you recommend first. Pick a sensible default for anything smaller.
- When you know enough, call create_plan once: a short name, a one or two sentence overview, the plan in markdown starting with a # heading (what changes, where, and how to check it works), and the to-dos in the order to do them.
- To revise the plan, edit its file directly. Don't call create_plan again.
- Don't start building. The user reviews the plan and presses Build when it's ready.`,
  gone: "Plan mode is off. Its instructions no longer apply.",
} satisfies PromptSection;

const createParameters = standard(
  Type.Object({
    name: Type.String({ minLength: 1, description: "A short name for the plan." }),
    overview: Type.String({
      minLength: 1,
      description: "What the plan does, in one or two sentences.",
    }),
    plan: Type.String({
      minLength: 1,
      description:
        "The plan in markdown, starting with a # heading: what changes, where, and how to check it works.",
    }),
    todos: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: "The implementation steps, in order, one short sentence each.",
    }),
  }),
);

const trackedPlanSchema = standard(
  Type.Object({
    path: Type.String(),
    todos: Type.Array(Type.Object({ content: Type.String(), done: Type.Boolean() })),
  }),
);

type TrackedPlan = Infer<typeof trackedPlanSchema>;

const cardActions = { build: { input: standard(Type.Object({})) } };

type CardActions = typeof cardActions;

type CardHandlers = {
  readonly [A in keyof CardActions]: (
    input: Infer<CardActions[A]["input"]>,
    context: ActionContext<PlanState, CardActions>,
  ) => Awaitable<ActionOutput<CardActions[A]>>;
};

const cardHandlers: CardHandlers = {
  build: async (_, context) => {
    const card = await findCardState(context.api.session, context.part.id);

    if (card === null) throw new Error("This plan can no longer be built.");

    if (card.built) return undefined;

    const settings = context.api.registries.settings;
    await settings.set(PLAN_MODE, false);

    await context.api.session
      .head(MAIN)
      .send(buildPrompt(card), {
        delivery: "queue",
        source: { kind: "action", label: `Build plan: ${card.name}` },
        id: asId(`plan-build-${context.part.id}`),
      })
      .catch(async (error: unknown) => {
        await settings.set(PLAN_MODE, true);
        throw error;
      });

    const updated = await context.part.update((current) => ({ ...current, built: true }));

    if (updated.kind !== "updated") throw new Error("This plan can no longer be built.");

    await closeCardTrays(context.api.session, context.part.id);

    return undefined;
  },
};

const trayActions = {
  build: { input: standard(Type.Object({})) },
  dismiss: { input: standard(Type.Object({})) },
};

type TrayActions = typeof trayActions;

type TrayHandlers = {
  readonly [A in keyof TrayActions]: (
    input: Infer<TrayActions[A]["input"]>,
    context: ActionContext<TrayState, TrayActions>,
  ) => Awaitable<ActionOutput<TrayActions[A]>>;
};

const trayHandlers: TrayHandlers = {
  build: async (_, context) => {
    const tray = (await openTrays(context.api.session)).find(
      (entry) => entry.id === context.part.id,
    );

    if (tray === undefined) throw new Error("This plan is no longer waiting to be built.");

    const outcome = await context.api.session.part(asId<"part">(tray.state.card)).act("build", {});

    if (outcome.kind === "rejected") throw new SdkError("invalid", outcome.reason);

    if (outcome.kind !== "ok") throw new Error(`The plan was not built: ${outcome.kind}.`);

    return undefined;
  },
  dismiss: async (_, context) => {
    await context.part.close();

    return undefined;
  },
};

const planTray = definePart({
  kind: "plan-tray",
  state: trayState,
  actions: trayActions,
  view: new URL("./plan-tray.view.tsx", import.meta.url),
  fallback: (current) => `Plan ready: ${current.name} (${current.todos} to-dos) ${current.path}`,
  onAction: (action, input, context) => trayHandlers[action](input, context),
});

const planCard = definePart({
  kind: "plan",
  state: planState,
  actions: cardActions,
  view: new URL("./plan.view.tsx", import.meta.url),
  fallback: (current) =>
    `Plan: ${current.name} (${current.todos.filter((todo) => todo.done).length} of ${current.todos.length} done) ${current.path}`,
  onAction: (action, input, context) => cardHandlers[action](input, context),
});

const createPlan: ToolDefinition<Infer<typeof createParameters>> = {
  name: "create_plan",
  when: on,
  description:
    "Save the implementation plan as a markdown file the user can read and edit, and show it in the chat with a Build button. Call it once per plan; revise the file directly afterwards.",
  parameters: createParameters,
  class: (args) => ({ kind: "custom", label: `Writing plan: ${args.name}` }),
  rerun: "never",
  async execute(args, invocation) {
    const env = invocation.env;

    const path = posix.join(
      env.cwd,
      PLANS_FOLDER,
      planFileName(args.name, crypto.randomUUID().slice(0, 8)),
    );

    const written = await env.files.write(
      path,
      writePlan({ name: args.name, overview: args.overview, body: args.plan, todos: args.todos }),
      { expect: "absent", parents: true },
    );

    if (written.kind !== "saved") throw new Error(`Couldn't write ${path}.`);

    const cardState: PlanState = {
      path,
      name: args.name,
      overview: args.overview,
      todos: args.todos.map((content) => ({ content: content.trim(), done: false })),
      built: false,
    };

    const card = await invocation.session.parts.create(planCard, {
      state: cardState,
      placement: { kind: "transcript", role: "answer" },
    });

    await rememberPlan(invocation.api.storage, card.id, { path, todos: cardState.todos });

    const createdTray = await invocation.session.parts.create(planTray, {
      state: planTrayState(card.id, cardState),
      placement: { kind: "tray" },
    });

    await closeOtherTrays(invocation.session, createdTray.id);

    return {
      content: [
        {
          kind: "text",
          text: `Saved the plan to ${path}. Tell the user it's ready to review; they edit it in place and press Build when it's right.`,
        } satisfies ToolContent,
      ],
      parts: [card.id],
    };
  },
};

const refreshPlans: HookHandler<"run_ended"> = async (_, context) => {
  const api = context.api;
  const keys = (await api.storage.keys()).filter((key) => key.startsWith(TRACKED_PREFIX));

  if (keys.length === 0) return;

  const trays = await openTrays(api.session);

  for (const key of keys) {
    const tracked = decode(trackedPlanSchema, await api.storage.get(key));

    if (tracked === null) {
      await api.storage.delete(key);
      continue;
    }

    const cardId = asId<"part">(key.slice(TRACKED_PREFIX.length));
    const todos = await readPlanTodos(api.env, tracked.path);

    if (todos === null) {
      await api.storage.delete(key);
      continue;
    }

    const changed =
      todos.length !== tracked.todos.length ||
      todos.some(
        (todo, index) =>
          todo.content !== tracked.todos[index]?.content ||
          todo.done !== tracked.todos[index]?.done,
      );

    if (changed) {
      const outcome = await api.session.part(cardId).update((current: Json) => {
        const decoded = decode(planState, current);

        return decoded === null ? current : { ...decoded, todos };
      });

      if (outcome.kind === "missing" || outcome.kind === "closed") {
        await api.storage.delete(key);
        continue;
      }
    }

    const done = todos.filter((todo) => todo.done).length;

    for (const open of trays.filter((candidate) => candidate.state.card === cardId)) {
      if (open.state.todos !== todos.length || open.state.done !== done) {
        await api.session.part(open.id).update((current: Json) => {
          const decoded = decode(trayState, current);

          return decoded === null
            ? current
            : planTrayState(cardId, { name: decoded.name, path: decoded.path, todos });
        });
      }
    }

    if (todos.length > 0 && done === todos.length) {
      await api.storage.delete(key);
    } else if (changed) {
      await rememberPlan(api.storage, cardId, { path: tracked.path, todos });
    }
  }
};

async function findCardState(session: Session, id: PartId): Promise<PlanState | null> {
  const view = await session.view();
  const inView = findCardInMessages(view.messages, id);

  if (inView !== null) return inView;

  let before = view.messages[0]?.id;

  while (before !== undefined) {
    const page = await session.history({ before, limit: HISTORY_PAGE_SIZE });
    const found = findCardInMessages(page.messages, id);

    if (found !== null) return found;
    before = page.messages[0]?.id;
  }

  return null;
}

function findCardInMessages(messages: readonly Message[], id: PartId): PlanState | null {
  for (const message of messages) {
    if (isPart(message, planCard) && message.part === id) return message.state;
  }

  return null;
}

async function closeCardTrays(session: Session, card: PartId): Promise<void> {
  for (const open of await openTrays(session)) {
    if (open.state.card === card) await session.part(open.id).close();
  }
}

async function closeOtherTrays(session: Session, keep: PartId): Promise<void> {
  for (const part of (await session.view()).parts) {
    if (part.partKind === planTray.kind && part.id !== keep) {
      await session.part(part.id).close();
    }
  }
}

async function openTrays(
  session: Session,
): Promise<readonly { readonly id: PartId; readonly state: TrayState }[]> {
  return (await session.view()).parts.flatMap((part) => {
    if (part.partKind !== planTray.kind || part.status.kind !== "live") return [];

    const checked = trayState["~standard"].validate(part.state);

    return checked instanceof Promise || checked.issues !== undefined
      ? []
      : [{ id: part.id, state: checked.value }];
  });
}

async function rememberPlan(
  storage: PluginStorage,
  id: PartId,
  tracked: TrackedPlan,
): Promise<void> {
  await storage.set(`${TRACKED_PREFIX}${id}`, tracked);
}

function decode<T>(schema: Schema<T>, value: Json | undefined): T | null {
  const checked = schema["~standard"].validate(value);

  return checked instanceof Promise || checked.issues !== undefined ? null : checked.value;
}

function buildPrompt(state: PlanState): string {
  return `Build the plan "${state.name}" in ${state.path}.

Read the plan first. Work through its to-dos in order, and tick each one in the plan file (- [x]) as soon as it's done. Don't change the rest of the plan file. Don't stop until every to-do is done.`;
}

async function readPlanTodos(env: ExecutionEnv, path: string): Promise<PlanState["todos"] | null> {
  const file = await env.files.read(path);

  return file.kind === "text" ? [...readTodos(file.contents)] : null;
}

export default {
  id: "plan-mode",
  contribute: {
    parts: [planCard, planTray],
    prompt: [instructions],
    settings: [mode],
    tools: [createPlan],
  },
  hooks: { run_ended: refreshPlans },
} satisfies Plugin;
