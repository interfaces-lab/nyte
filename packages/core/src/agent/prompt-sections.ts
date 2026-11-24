import { SdkError } from "@nyte-ai/schema";
import type {
  CommitId,
  HeadName,
  ModelRef,
  PromptOverride,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import type { SystemMessage, UserMessage } from "@nyte-ai/schema/model";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import { decodePromptRecord } from "../contract/records.ts";
import type { PromptRecord } from "../contract/records.ts";
import type { Resources } from "../contract/workspace.ts";
import { commit } from "../watch/commit.ts";
import { promptRef } from "../store/refs.ts";
import { attempt, load, put, readRefExpectation, STALE } from "../store/session.ts";

interface SystemSection {
  readonly id: string;
  readonly text: string;
}

export interface FixedSection {
  readonly id: string;
  readonly text: string;
  readonly order?: number;
}

export interface ReminderSection {
  readonly id: string;
  readonly text: string;
  readonly gone: string;
}

interface SystemPrompt {
  readonly head: SystemMessage | null;
  readonly updates: ReadonlyMap<CommitId, readonly SystemMessage[]>;
  readonly reminders: ReadonlyMap<CommitId, readonly UserMessage[]>;
}

type Update = PromptRecord["updates"][number];

type ReminderEntry = NonNullable<PromptRecord["reminders"]>[number];

export function systemSections(
  own: PromptOverride | null,
  agent: PromptOverride | null,
  prompt: Resources["prompt"],
  sections: readonly FixedSection[],
): readonly SystemSection[] {
  if (own?.kind === "replace") return nonEmpty([{ id: "prompt", text: own.text }]);

  if (agent?.kind === "replace") return nonEmpty([{ id: "prompt", text: agent.text }]);

  const body =
    prompt.system === null
      ? [...sections, ...layerSection("session", own), ...layerSection("agent", agent)]
          .map((section) => ({ id: section.id, text: section.text, order: section.order ?? 100 }))
          .sort(
            (left, right) =>
              left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
          )
          .map((section) => {
            const tag = `${String(section.order).padStart(4, "0")}-${section.id}`;

            return { id: section.id, text: `<${tag}>\n${section.text}\n</${tag}>` };
          })
      : [{ id: "SYSTEM.md", text: prompt.system }];

  return nonEmpty([
    ...body,
    ...(prompt.append === null ? [] : [{ id: "APPEND_SYSTEM.md", text: prompt.append }]),
  ]);
}

export async function resolveSections(
  runtime: PluginRuntime,
  model: ModelRef,
): Promise<{
  readonly system: readonly FixedSection[];
  readonly reminders: readonly ReminderSection[];
}> {
  const system: FixedSection[] = [];
  const reminders: ReminderSection[] = [];

  const resolved = await Promise.all(
    runtime.registries.prompt.entries().map(async (entry) => {
      const section = entry.item;

      if (typeof section.text === "string") return { section, text: section.text };
      const api = runtime.api(entry.owner);

      if (api === undefined) {
        throw new SdkError(
          "internal",
          `Plugin ${entry.owner} is not active, so its prompt section ${section.id} has no API.`,
        );
      }

      const text = await Promise.resolve(section.text({ model, api })).catch((error: unknown) => {
        if (error instanceof SdkError && error.code === "unavailable") return null;

        throw new SdkError(
          "internal",
          `Plugin ${entry.owner}'s prompt section ${section.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

      return text === null ? null : { section, text };
    }),
  );

  for (const item of resolved) {
    if (item === null) continue;
    const { section, text } = item;

    if (section.delivery === "reminder") {
      reminders.push({ id: section.id, text, gone: section.gone });
    } else {
      system.push({ id: section.id, text, order: section.order });
    }
  }

  return { system, reminders };
}

export async function settleSystemPrompt(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly sections: readonly SystemSection[];
    readonly reminders: readonly ReminderSection[];
    readonly commits: readonly CommitId[];
    readonly compacted: ReadonlySet<CommitId>;
    readonly folds: boolean;
  },
): Promise<SystemPrompt> {
  const name = promptRef(input.session, input.head);

  const settled = await attempt(`Recording ${input.head}'s system prompt`, async () => {
    const ref = await kernel.store.refs.get(name);
    const known = await load(kernel.store, ref, decodePromptRecord);
    const next = settle(known?.record, input);

    if (known !== null && JSON.stringify(known.record) === JSON.stringify(next)) return next;

    const outcome = await commit(
      kernel,
      [{ name, target: await put(kernel.store, "prompt", next), expect: readRefExpectation(ref) }],
      input.run === null ? null : { session: input.session, run: input.run },
    );

    if (outcome.kind === "fenced") {
      throw new SdkError("stale", `Run ${input.run} stopped while its request was built.`);
    }

    return outcome.kind === "set" ? next : STALE;
  });

  const reminders = new Map(
    [...Map.groupBy(settled.reminders ?? [], (entry) => entry.after)].map(([after, entries]) => [
      after,
      entries.map(reminderMessage),
    ]),
  );

  if (input.folds) return { head: systemMessage(input.sections), updates: new Map(), reminders };

  return {
    reminders,
    head: settled.sections.length === 0 ? null : systemMessage(settled.sections),
    updates: new Map(
      [...Map.groupBy(settled.updates, (update) => update.after)].map(([after, updates]) => [
        after,
        updates.map((update) => systemMessage(update.sections)),
      ]),
    ),
  };
}

function settle(
  recorded: PromptRecord | undefined,
  input: {
    readonly sections: readonly SystemSection[];
    readonly reminders: readonly ReminderSection[];
    readonly commits: readonly CommitId[];
    readonly compacted: ReadonlySet<CommitId>;
  },
): PromptRecord {
  const reminders = settleReminders(recorded?.reminders ?? [], input);

  return reminders.length === 0
    ? settleSections(recorded, input)
    : { ...settleSections(recorded, input), reminders };
}

function settleSections(
  recorded: PromptRecord | undefined,
  input: {
    readonly sections: readonly SystemSection[];
    readonly commits: readonly CommitId[];
    readonly compacted: ReadonlySet<CommitId>;
  },
): PromptRecord {
  if (recorded === undefined) return { sections: input.sections, updates: [] };
  const on = new Set(input.commits);

  const base = recorded.updates
    .filter((update) => input.compacted.has(update.after))
    .reduce(applyUpdate, recorded.sections);

  const kept = recorded.updates.filter(
    (update) => on.has(update.after) && !input.compacted.has(update.after),
  );

  const change = diffSections(kept.reduce(applyUpdate, base), input.sections);
  const after = input.commits.at(-1);

  if (change.length === 0) return { sections: base, updates: kept };

  if (after === undefined) return { sections: input.sections, updates: [] };

  return { sections: base, updates: [...kept, { after, sections: change }] };
}

function settleReminders(
  recorded: readonly ReminderEntry[],
  input: {
    readonly commits: readonly CommitId[];
    readonly compacted: ReadonlySet<CommitId>;
    readonly reminders: readonly ReminderSection[];
  },
): readonly ReminderEntry[] {
  const path = new Set(input.commits);
  const onPath = recorded.filter((entry) => path.has(entry.after));
  const after = input.commits.at(-1);

  if (after === undefined) return [];
  const current = new Map(input.reminders.map((section) => [section.id, section]));
  const latestAny = new Map<string, ReminderEntry>();
  const latestLive = new Map<string, ReminderEntry>();

  for (const entry of onPath) {
    latestAny.set(entry.id, entry);

    if (!input.compacted.has(entry.after)) latestLive.set(entry.id, entry);
  }

  const left = [...latestAny.values()].flatMap((entry) =>
    !current.has(entry.id) && entry.text !== null
      ? [{ after, id: entry.id, text: null, gone: entry.gone }]
      : [],
  );

  const told = input.reminders.flatMap((section) =>
    latestLive.get(section.id)?.text !== section.text
      ? [{ after, id: section.id, text: section.text, gone: section.gone }]
      : [],
  );

  const kept = onPath.filter((entry) => !input.compacted.has(entry.after));

  return [...kept, ...left, ...told];
}

function reminderMessage(entry: ReminderEntry): UserMessage {
  return {
    role: "user",
    content: `<system-reminder>\n${entry.text ?? entry.gone}\n</system-reminder>`,
    timestamp: 0,
  };
}

function applyUpdate(sections: readonly SystemSection[], update: Update): readonly SystemSection[] {
  const changed = new Map(update.sections.map((section) => [section.id, section.text]));

  const kept = sections.flatMap((section) => {
    const text = changed.get(section.id);

    if (text === undefined) return [section];

    return text === null ? [] : [{ id: section.id, text }];
  });

  const added = update.sections.flatMap((section) =>
    section.text === null || sections.some((known) => known.id === section.id)
      ? []
      : [{ id: section.id, text: section.text }],
  );

  return [...kept, ...added];
}

function diffSections(
  seen: readonly SystemSection[],
  next: readonly SystemSection[],
): Update["sections"] {
  const before = new Map(seen.map((section) => [section.id, section.text]));
  const ids = new Set(next.map((section) => section.id));

  return [
    ...next.filter((section) => before.get(section.id) !== section.text),
    ...seen.flatMap((section) => (ids.has(section.id) ? [] : [{ id: section.id, text: null }])),
  ];
}

function systemMessage(sections: Update["sections"]): SystemMessage {
  return {
    role: "system",
    content: "",
    sections: Object.fromEntries(sections.map((section) => [section.id, section.text])),
    timestamp: 0,
  };
}

function layerSection(id: string, override: PromptOverride | null): readonly FixedSection[] {
  return override?.kind === "layer" ? [{ id, text: override.text, order: override.order }] : [];
}

function nonEmpty(sections: readonly SystemSection[]): readonly SystemSection[] {
  return sections.filter((section) => section.text !== "");
}
