import { SdkError } from "@nyte-ai/schema";
import type { CommitId, HeadName, PromptOverride, RunId, SessionId } from "@nyte-ai/schema";
import type { SystemMessage } from "@nyte-ai/schema/model";
import type { Kernel } from "../contract/kernel.ts";
import type { PromptSection } from "../contract/plugin.ts";
import { decodePromptRecord } from "../contract/records.ts";
import type { PromptRecord } from "../contract/records.ts";
import type { Resources } from "../contract/workspace.ts";
import { commit } from "../fold/commit.ts";
import { promptRef } from "../store/refs.ts";
import { attempt, load, put, readRefExpectation, STALE } from "../store/session.ts";

export type SystemSection = { readonly id: string; readonly text: string };

export type SystemPrompt = {
  readonly head: SystemMessage | null;
  readonly updates: ReadonlyMap<CommitId, readonly SystemMessage[]>;
};

type Update = PromptRecord["updates"][number];

export function systemSections(
  own: PromptOverride | null,
  agent: PromptOverride | null,
  prompt: Resources["prompt"],
  sections: readonly PromptSection[],
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

export async function settleSystemPrompt(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId | null;
    readonly sections: readonly SystemSection[];
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

    if (outcome.kind === "fenced")
      throw new SdkError("stale", `Run ${input.run} stopped while its request was built.`);

    return outcome.kind === "set" ? next : STALE;
  });

  if (input.folds) return { head: systemMessage(input.sections), updates: new Map() };

  return {
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

function layerSection(id: string, override: PromptOverride | null): readonly PromptSection[] {
  return override?.kind === "layer" ? [{ id, text: override.text, order: override.order }] : [];
}

function nonEmpty(sections: readonly SystemSection[]): readonly SystemSection[] {
  return sections.filter((section) => section.text !== "");
}
