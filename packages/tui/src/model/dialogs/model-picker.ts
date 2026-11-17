import type { ModelMode } from "@nyte-ai/schema/model";
import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import {
  availableModels,
  availableModes,
  clampThinking,
  modelId,
  modelWithModes,
  selectedModes,
} from "../../lib/catalog.ts";
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
  readonly field: ModelField;
  readonly drafts: ReadonlyMap<string, RowDraft>;
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
}

export type ModelField = "effort" | ModelMode;

interface RowDraft {
  readonly effort: Thinking;
  readonly modes: readonly ModelMode[];
}

const PAGE = 9;

export function modelList(catalog: ModelCatalogView): ModelList {
  const rows = availableModels(catalog).map((info) => ({ ref: info.ref, info }));

  return {
    rows,
    costCeiling: rows.reduce(
      (max, row) => Math.max(max, row.info.cost.input + row.info.cost.output),
      0,
    ),
  };
}

export function currentRowId(rows: readonly ModelRow[], current: ModelRef): string {
  const base = rows.find((row) => selectedModes(row.info, current) !== null);

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
  const row = list.rows.find((candidate) => modelId(candidate.ref) === current);

  if (!drafts.has(current))
    drafts.set(current, {
      effort: dialog.effort,
      modes: row === undefined ? [] : (selectedModes(row.info, dialog.current) ?? []),
    });

  return { ...dialog, models: { kind: "ready", list }, highlighted, drafts };
}

export function visibleModels(dialog: ModelDialog): readonly ModelRow[] {
  if (dialog.models.kind !== "ready") return [];

  return dialog.models.list.rows.filter((row) =>
    matchesTerms(dialog.query, `${row.info.name} ${modelId(row.ref)}`),
  );
}

export function rowDraft(dialog: ModelDialog, row: ModelRow): RowDraft {
  const draft = dialog.drafts.get(modelId(row.ref));

  return {
    effort: clampThinking(row.info, draft?.effort ?? dialog.effort),
    modes: availableModes(row.info).filter((mode) => draft?.modes.includes(mode) === true),
  };
}

export function modelFields(row: ModelRow): readonly ModelField[] {
  return [
    ...(row.info.thinking.length > 1 ? ["effort" as const] : []),
    ...availableModes(row.info),
  ];
}

export function activeField(dialog: ModelDialog, row: ModelRow): ModelField | null {
  const fields = modelFields(row);

  return fields.includes(dialog.field) ? dialog.field : (fields[0] ?? null);
}

/** The field `model.field.cycle` moves to on `row`, wrapping after the last. */
export function nextField(dialog: ModelDialog, row: ModelRow): ModelField | null {
  const fields = modelFields(row);
  const active = activeField(dialog, row);

  return fields[(fields.findIndex((field) => field === active) + 1) % fields.length] ?? null;
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

  if (field !== "effort")
    drafts.set(modelId(row.ref), {
      ...draft,
      modes: availableModes(row.info).filter((mode) =>
        mode === field ? delta === 1 : draft.modes.includes(mode),
      ),
    });
  else {
    const levels = row.info.thinking;
    const index = Math.max(
      0,
      Math.min(levels.length - 1, levels.findIndex((level) => level === draft.effort) + delta),
    );
    drafts.set(modelId(row.ref), { ...draft, effort: levels[index] ?? draft.effort });
  }

  return { ...dialog, drafts };
}

function confirm(dialog: ModelDialog): DialogStep<ModelDialog> {
  const row = visibleModels(dialog)[dialog.highlighted];

  if (row === undefined) return unchanged(dialog);
  const draft = rowDraft(dialog, row);
  const model = modelWithModes(row.info, draft.modes);

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
    intents: [
      { kind: "configure", selection: { model, effort: draft.effort, modes: draft.modes } },
    ],
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
    case "model.field.cycle": {
      const row = rows[dialog.highlighted];
      const field = row === undefined ? null : nextField(dialog, row);

      return unchanged(field === null ? dialog : { ...dialog, field });
    }
    default:
      return unchanged(dialog);
  }
}
