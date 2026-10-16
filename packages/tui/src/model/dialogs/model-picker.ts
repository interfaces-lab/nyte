import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import { availableModels, clampThinking, modelId } from "../../lib/catalog.ts";
import type { DialogCommand, DialogId, DialogStep } from "./dialog.ts";
import { matchesTerms } from "./list.ts";

export interface ModelDialog {
  readonly kind: "model";
  readonly id: DialogId;
  readonly models:
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly list: ModelList }
    | { readonly kind: "failed"; readonly message: string };
  readonly query: string;
  readonly caret?: number;
  readonly anchor?: number;
  readonly highlighted: number;
  readonly field: "effort" | "fast";
  readonly drafts: ReadonlyMap<string, { readonly effort: Thinking; readonly fast: boolean }>;
  readonly current: ModelRef;
  readonly effort: Thinking;
}

export interface ModelList {
  readonly rows: readonly ModelRow[];
  readonly costCeiling: number;
}

export interface ModelRow {
  readonly ref: ModelRef;
  readonly info: ModelInfo;
  readonly fast: ModelInfo | null;
}

const PAGE = 9;

export function modelList(catalog: ModelCatalogView): ModelList {
  const rows = availableModels(catalog).map((info) => ({ ref: info.ref, info, fast: null }));

  return {
    rows,
    costCeiling: rows.reduce(
      (max, row) => Math.max(max, row.info.cost.input + row.info.cost.output),
      0,
    ),
  };
}

export function currentRowId(rows: readonly ModelRow[], current: ModelRef): string {
  const base = rows.find(
    (row) => row.info.fast !== null && modelId(row.info.fast) === modelId(current),
  );

  return modelId(base?.ref ?? current);
}

export function withModels(dialog: ModelDialog, list: ModelList): ModelDialog {
  const current = currentRowId(list.rows, dialog.current);
  const shown = visibleModels(dialog)[dialog.highlighted];
  const keep = shown === undefined ? current : modelId(shown.ref);

  const highlighted = Math.max(
    0,
    list.rows.findIndex((row) => modelId(row.ref) === keep),
  );

  const drafts = new Map(dialog.drafts);

  if (!drafts.has(current))
    drafts.set(current, { effort: dialog.effort, fast: current !== modelId(dialog.current) });

  return { ...dialog, models: { kind: "ready", list }, highlighted, drafts };
}

export function visibleModels(dialog: ModelDialog): readonly ModelRow[] {
  if (dialog.models.kind !== "ready") return [];

  return dialog.models.list.rows.filter((row) =>
    matchesTerms(dialog.query, `${row.info.name} ${modelId(row.ref)}`),
  );
}

export interface RowDraft {
  readonly effort: Thinking;
  readonly fast: boolean;
}

export function rowDraft(dialog: ModelDialog, row: ModelRow): RowDraft {
  const draft = dialog.drafts.get(modelId(row.ref));

  return {
    effort: clampThinking(row.info, draft?.effort ?? dialog.effort),
    fast: row.info.fast !== null && (draft?.fast ?? false),
  };
}

export function modelFields(row: ModelRow): readonly ("effort" | "fast")[] {
  return [
    ...(row.info.thinking.length > 1 ? ["effort" as const] : []),
    ...(row.info.fast === null ? [] : ["fast" as const]),
  ];
}

export function activeField(dialog: ModelDialog, row: ModelRow): "effort" | "fast" | null {
  const fields = modelFields(row);

  return fields.includes(dialog.field) ? dialog.field : (fields[0] ?? null);
}

function unchanged(dialog: ModelDialog): DialogStep<ModelDialog> {
  return { dialog, intents: [], push: null };
}

function change(dialog: ModelDialog, delta: -1 | 1): ModelDialog {
  const row = visibleModels(dialog)[dialog.highlighted];

  if (row === undefined) return dialog;
  const field = activeField(dialog, row);

  if (field === null) return dialog;
  const draft = rowDraft(dialog, row);
  const drafts = new Map(dialog.drafts);

  if (field === "fast") drafts.set(modelId(row.ref), { ...draft, fast: delta === 1 });
  else {
    const levels = row.info.thinking;
    const index = Math.max(0, Math.min(levels.length - 1, levels.indexOf(draft.effort) + delta));
    drafts.set(modelId(row.ref), { ...draft, effort: levels[index] ?? draft.effort });
  }

  return { ...dialog, drafts };
}

function confirm(dialog: ModelDialog): DialogStep<ModelDialog> {
  const row = visibleModels(dialog)[dialog.highlighted];

  if (row === undefined) return unchanged(dialog);
  const draft = rowDraft(dialog, row);
  const model = draft.fast && row.info.fast !== null ? row.info.fast : row.ref;

  if (modelId(model) === modelId(dialog.current) && draft.effort === dialog.effort)
    return {
      dialog: null,
      intents: [
        {
          kind: "refuse",
          reason: `Already using ${modelId(model)} · ${draft.effort}`,
          tone: "info",
        },
      ],
      push: null,
    };

  return {
    dialog: null,
    intents: [{ kind: "configure", selection: { model, effort: draft.effort, fast: draft.fast } }],
    push: null,
  };
}

export function reduceModel(dialog: ModelDialog, command: DialogCommand): DialogStep<ModelDialog> {
  if (command.kind === "close") return { dialog: null, intents: [], push: null };
  const rows = visibleModels(dialog);

  if (command.kind === "query") {
    const previous = rows[dialog.highlighted];
    const next = { ...dialog, query: command.text };

    const index = visibleModels(next).findIndex(
      (row) => previous !== undefined && row === previous,
    );

    return unchanged({ ...next, highlighted: Math.max(0, index) });
  }

  if (command.kind === "pick" || command.kind === "highlight") {
    if (rows[command.index] === undefined) return unchanged(dialog);
    const highlighted = { ...dialog, highlighted: command.index };

    return command.kind === "pick" ? confirm(highlighted) : unchanged(highlighted);
  }

  const count = rows.length;

  const to = (index: number): DialogStep<ModelDialog> =>
    unchanged({ ...dialog, highlighted: index });

  switch (command.name) {
    case "picker.close":
      return { dialog: null, intents: [], push: null };
    case "picker.accept":
      return confirm(dialog);
    case "model.previous":
      return count === 0 ? unchanged(dialog) : to((dialog.highlighted - 1 + count) % count);
    case "model.next":
      return count === 0 ? unchanged(dialog) : to((dialog.highlighted + 1) % count);
    case "picker.page.up":
      return to(Math.max(0, dialog.highlighted - PAGE));
    case "picker.page.down":
      return to(Math.max(0, Math.min(count - 1, dialog.highlighted + PAGE)));
    case "model.decrease":
      return unchanged(change(dialog, -1));
    case "model.increase":
      return unchanged(change(dialog, 1));
    case "model.field.cycle":
      return unchanged({ ...dialog, field: dialog.field === "effort" ? "fast" : "effort" });
    default:
      return unchanged(dialog);
  }
}
