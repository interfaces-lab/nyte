import type { Json } from "@nyte-ai/sdk";
import { availableModels, clampThinking, findModel, modelId } from "../lib/catalog.ts";
import { keycap } from "../lib/constants.ts";
import type { Intent } from "./msg.ts";
import { followedSession } from "./state.ts";
import type { State } from "./state.ts";

export interface SettingChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly apply: Intent;
}

export interface SettingRow {
  readonly id: string;
  readonly label: string;
  readonly current: string;
  readonly choices: readonly SettingChoice[];
  readonly whileBusy: boolean;
}

function onOff(
  id: string,
  label: string,
  value: boolean,
  on: string,
  off: string,
  patch: (value: boolean) => Intent,
): SettingRow {
  return {
    id,
    label,
    current: value ? "on" : "off",
    choices: [
      { id: "on", label: "on", description: on, apply: patch(true) },
      { id: "off", label: "off", description: off, apply: patch(false) },
    ],
    whileBusy: false,
  };
}

function jsonId(value: Json): string {
  return JSON.stringify(value);
}

export function settingRows(state: State): readonly SettingRow[] {
  const session = state.facts.chat;
  const { settings } = state.facts;
  const catalog = state.facts.catalog.catalog;
  const models = catalog === null ? [] : availableModels(catalog);
  const selection = session?.selection ?? null;
  const effortModel = selection === null ? undefined : findModel(models, selection.model);

  const providerName = (provider: string): string =>
    catalog?.providers.find((candidate) => candidate.id === provider)?.name ?? provider;

  const plugin = (followedSession(state)?.view?.catalog.settings ?? state.facts.hostSettings).flatMap(
    (setting): SettingRow[] =>
      setting.choices === null
        ? []
        : [
            {
              id: setting.id,
              label: setting.label,
              current: jsonId(setting.value),
              choices: setting.choices.map((choice) => ({
                id: jsonId(choice.value),
                label: choice.label,
                description: choice.badge ?? "",
                apply: {
                  kind: "apply-setting",
                  id: setting.id,
                  label: setting.label,
                  scope: setting.scope,
                  value: choice.value,
                },
              })),
              whileBusy: setting.scope === "host",
            },
          ],
  );

  return [
    {
      id: "model",
      label: "Model",
      current: selection === null ? "" : modelId(selection.model),
      choices: models.map((model) => ({
        id: modelId(model.ref),
        label: model.name === "" ? model.ref.id : model.name,
        description:
          model.name === model.ref.id
            ? providerName(model.ref.provider)
            : `${providerName(model.ref.provider)} · ${model.ref.id}`,
        apply: {
          kind: "configure",
          selection: {
            model: model.ref,
            effort: clampThinking(model, selection?.effort ?? "medium"),
            fast: false,
          },
        },
      })),
      whileBusy: true,
    },
    {
      id: "effort",
      label: "Thinking level",
      current: selection?.effort ?? "",
      choices: (effortModel?.thinking ?? []).map((level) => ({
        id: level,
        label: level,
        description: "",
        apply: { kind: "configure", selection: { effort: level } },
      })),
      whileBusy: true,
    },
    {
      id: "theme",
      label: "Theme",
      current: settings.theme,
      choices: [
        {
          id: "auto",
          label: "auto",
          description: "Follow the terminal's color scheme",
          apply: { kind: "write-settings", patch: { theme: "auto" } },
        },
        {
          id: "dark",
          label: "dark",
          description: "",
          apply: { kind: "write-settings", patch: { theme: "dark" } },
        },
        {
          id: "light",
          label: "light",
          description: "",
          apply: { kind: "write-settings", patch: { theme: "light" } },
        },
      ],
      whileBusy: false,
    },
    {
      id: "follow-up",
      label: "Follow-up behavior",
      current: settings.followUp,
      choices: [
        {
          id: "steer",
          label: "steer",
          description: `Enter steers; ${keycap("chat.queue.submit")} queues`,
          apply: { kind: "write-settings", patch: { followUp: "steer" } },
        },
        {
          id: "queue",
          label: "queue",
          description: `Enter queues; ${keycap("chat.queue.submit")} steers`,
          apply: { kind: "write-settings", patch: { followUp: "queue" } },
        },
      ],
      whileBusy: false,
    },
    onOff(
      "scroll-acceleration",
      "Scroll acceleration",
      settings.scrollAcceleration,
      "Accelerate during rapid wheel scrolling",
      "Move three rows per wheel event",
      (value) => ({ kind: "write-settings", patch: { scrollAcceleration: value } }),
    ),
    onOff(
      "copy-on-select",
      "Copy on select",
      settings.copyOnSelect,
      "Copy text when the mouse selection ends",
      "Copy selected text with Ctrl+C or right-click",
      (value) => ({ kind: "write-settings", patch: { copyOnSelect: value } }),
    ),
    onOff(
      "auto-update",
      "Auto-update",
      settings.autoUpdate,
      "Install a newer release when nyte starts",
      "Only say when one exists; /update installs",
      (value) => ({ kind: "write-settings", patch: { autoUpdate: value } }),
    ),
    ...plugin,
  ];
}

export function settingValue(row: SettingRow): string {
  return row.choices.find((choice) => choice.id === row.current)?.label ?? row.current;
}

export function matchChoice(row: SettingRow, argument: string): SettingChoice | null {
  return (
    row.choices.find(
      (choice) =>
        choice.id === argument ||
        choice.id === JSON.stringify(argument) ||
        choice.label === argument ||
        choice.id.endsWith(`/${argument}`),
    ) ?? null
  );
}

export function busyRefusal(state: State, row: SettingRow): Intent | null {
  const execution = followedSession(state)?.view?.execution;

  return execution !== undefined && execution.kind !== "idle" && !row.whileBusy
    ? { kind: "refuse", reason: `Wait for the current run before changing ${row.label}` }
    : null;
}

export function applyChoice(state: State, row: SettingRow, choice: SettingChoice): Intent {
  return busyRefusal(state, row) ?? choice.apply;
}
