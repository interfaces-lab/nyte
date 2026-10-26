import { useDialKit } from "dialkit";
import { DISPLAY_MODES } from "../shell/display-mode";
import type { DisplayMode } from "../shell/display-mode";
import type { Matching } from "./contract.ts";
import { DEFAULT_KNOBS } from "./world.ts";
import type { Knobs, ModelId } from "./world.ts";

const MODELS = [
  { value: "openai-codex/gpt-6.1-sol", label: "Sol" },
  { value: "anthropic/claude-opus-5-5", label: "Opus" },
] as const satisfies readonly { value: ModelId; label: string }[];

const MATCHING = [
  { value: "step-and-files", label: "Step + files" },
  { value: "check-name", label: "Check name" },
] as const satisfies readonly { value: Matching; label: string }[];

function findModel(value: string, fallback: ModelId): ModelId {
  return MODELS.find((model) => model.value === value)?.value ?? fallback;
}

export interface ProjectDials {
  readonly knobs: Knobs;
  readonly journey: boolean;
  readonly scheme: DisplayMode;
}

export function useProjectDials(): ProjectDials {
  const values = useDialKit("Stacks", {
    scheme: { type: "select", options: [...DISPLAY_MODES], default: "light" },
    journey: true,
    models: {
      worker: { type: "select", options: [...MODELS], default: DEFAULT_KNOBS.worker },
      reviewer: { type: "select", options: [...MODELS], default: DEFAULT_KNOBS.reviewer },
      babysitter: { type: "select", options: [...MODELS], default: DEFAULT_KNOBS.babysitter },
    },
    rules: {
      changesetsGate: DEFAULT_KNOBS.gateChangesets,
      formatFixOnMain: DEFAULT_KNOBS.remedies,
      groupSharedFailures: DEFAULT_KNOBS.families,
      sameFailure: { type: "select", options: [...MATCHING], default: DEFAULT_KNOBS.matching },
    },
    limits: {
      attempts: [DEFAULT_KNOBS.attempts, 1, 10, 1],
      budgetUsd: [DEFAULT_KNOBS.budgetUsd, 0.5, 10, 0.5],
      lifetimeDays: [DEFAULT_KNOBS.lifetimeDays, 1, 30, 1],
      pollPendingSeconds: [DEFAULT_KNOBS.pollPendingSeconds, 15, 300, 15],
      pollSettledSeconds: [DEFAULT_KNOBS.pollSettledSeconds, 60, 1800, 60],
      _collapsed: true,
    },
  });

  return {
    journey: values.journey,
    scheme: DISPLAY_MODES.find((mode) => mode.value === values.scheme)?.value ?? "light",
    knobs: {
      worker: findModel(values.models.worker, DEFAULT_KNOBS.worker),
      reviewer: findModel(values.models.reviewer, DEFAULT_KNOBS.reviewer),
      babysitter: findModel(values.models.babysitter, DEFAULT_KNOBS.babysitter),
      gateChangesets: values.rules.changesetsGate,
      remedies: values.rules.formatFixOnMain,
      families: values.rules.groupSharedFailures,
      matching:
        MATCHING.find((option) => option.value === values.rules.sameFailure)?.value ??
        DEFAULT_KNOBS.matching,
      attempts: values.limits.attempts,
      budgetUsd: values.limits.budgetUsd,
      lifetimeDays: values.limits.lifetimeDays,
      pollPendingSeconds: values.limits.pollPendingSeconds,
      pollSettledSeconds: values.limits.pollSettledSeconds,
    },
  };
}
