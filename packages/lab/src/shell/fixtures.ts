import { sessionId } from "@nyte-ai/protocol";
import type { RunPhase, SessionInfo } from "@nyte-ai/protocol";
import type { RenderedTurn } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { DesktopCatalog, DesktopModelOption } from "@nyte-ai/app/bridge.ts";

export const parentSessionId = sessionId("lab-parent");

const now = Date.now();

function subagent(id: string, name: string, phase: RunPhase, awaitingReply?: true): SessionInfo {
  return {
    sessionId: sessionId(id),
    activation: { kind: "active" },
    name,
    createdAt: now - 600_000,
    lastActivityAt: now - 60_000,
    pinned: false,
    archived: false,
    config: {},
    parent: { sessionId: parentSessionId, runId: "lab-run", callId: id, depth: 1 },
    heads: [
      {
        head: "main",
        tip: null,
        run: {
          runId: `${id}-run`,
          head: "main",
          origin: { kind: "user" },
          root: `${id}-run`,
          phase,
          startedAt: now - 600_000,
          attempts: 1,
          config: {},
          awaitingReply,
        },
      },
    ],
  };
}

export const subagents = [
  subagent("lab-agent-audit", "Audit floating surface shadows", { kind: "tools" }),
  subagent("lab-agent-trust", "Confirm workspace trust copy", { kind: "waiting" }, true),
  subagent("lab-agent-tokens", "Map translucent tints to nyte tokens", { kind: "respond" }),
  subagent("lab-agent-review", "Review titlebar alignment", { kind: "done" }),
] as const;

const prompts = [
  "Audit the shadows on menus, popovers and dialogs, tier by tier.",
  "Which of those need color-mix because the fill is translucent?",
  "Split the popover shadow so menus and pickers can sit on different tiers.",
  "What does the secondary button change if we move its padding to v2?",
  "Check the titlebar controls' alignment with the traffic lights.",
  "Now make the workbench in @file:///Users/lab/nyte/packages/lab/src/shell/desktop-demo.tsx the real one, it's that important to look exact.",
] as const;

const replies = [
  [
    "Assign each surface an elevation tier by role rather than size.",
    "- **elevation-low** (`shadow-sm`): ordinary menus and context menus.\n- **elevation-middle** (`shadow-md`): suggestion lists, pickers and the material panel.\n- **elevation-high** (`shadow-lg`): dialogs only.",
    "Split the popover token so menus use a lighter shadow while pickers keep their current tier.",
    "Keep the inset hairline on `role.borderSecondaryTranslucent` in both appearances.",
  ],
  [
    "Every step derived from an anchor with alpha: the text ramp at 74, 60 and 36 percent, the icon ramp at 66 and 52, the fill steps and the strokes.",
    "Flattening them to hex breaks as soon as the surface underneath changes, which is exactly what the material menus do: the blur shows the transcript through the fill, so a pre-mixed grey reads darker over white and lighter over the sidebar.",
    "Use translucent colour roles so the fill composites against whatever sits behind it.",
  ],
  [
    "Two tokens now: `shadow.shadowSm` for menus and context menus on `shadow-sm`, and `shadow.shadowMd` for suggestion lists, the model picker and toasts on `shadow-md`.",
    "`floating-surface.stylex.ts` takes the tier as a variant, so every popup names its role once and the shadow follows from it. Dialogs keep `shadow.shadowLg` on `shadow-lg`.",
    "Nothing else moves: the inset hairline, the radius and the material fill are shared by both tiers.",
  ],
  [
    "Moving to v2 widens labelled buttons by 4px and raises them by 2px. Icon-only buttons keep their square boxes.",
    "Dialog footers gain 2px of height, and the two-button row in the confirm dialog grows from 170px to 178px wide.",
  ],
  [
    "The titlebar centres its tracks in a 44px bar, putting the icon centre at 22px against the traffic lights' 17px. Aligning to the lights means `align-items: flex-start` with a 3px top inset on the action tracks.",
    "The title slot follows the same inset, so the session title reads on the lights' centre line as well.",
  ],
  [
    "The lab now mounts the desktop `Workbench` itself: the named rail, the compact icon rail and the open Changes panel all come from the renderer, fed by a fixture host that answers the workspace and version-control reads.",
    "> The few reads the real workbench needs answer with fixture data; every other call rejects, so a panel with no fixture shows its own failed state.",
    "The subagent tray above the composer uses fixture agents in working, waiting and finished states.",
  ],
] as const;

export const turns = prompts.map((prompt, index): RenderedTurn => ({
  kind: "turn",
  id: `lab-turn-${String(index)}`,
  run: { kind: "none" },
  startedAt: now - (prompts.length - index) * 600_000,
  durationMs: 42_000,
  parts: [
    {
      kind: "user",
      commit: `lab-user-${String(index)}`,
      parent: null,
      content: prompt,
      at: now - (prompts.length - index) * 600_000,
    },
    ...(replies[index] ?? []).map((text, contentIndex) => ({
      kind: "assistant" as const,
      commit: `lab-reply-${String(index)}`,
      contentIndex,
      text,
      at: now - (prompts.length - index) * 600_000 + 1_000,
    })),
  ],
}));

function model(
  provider: string,
  id: string,
  name: string,
  thinkingLevels: DesktopModelOption["thinkingLevels"],
  fast: boolean,
): DesktopModelOption {
  return {
    key: `${provider}/${id}`,
    provider,
    id,
    name,
    contextWindow: 200_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    thinkingLevels,
    fastMode: fast ? { kind: "available", settingId: `${id}-fast` } : { kind: "unavailable" },
    hidden: false,
    listed: true,
  };
}

export const labModel = model(
  "anthropic",
  "claude-opus",
  "Claude Opus 4.5",
  ["off", "low", "medium", "high"],
  true,
);

export const modelCatalog = {
  source: "local",
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      enabled: true,
      connection: { kind: "oauth" },
      signIn: [],
    },
    {
      id: "openai",
      name: "OpenAI",
      enabled: true,
      connection: { kind: "api_key", env: "OPENAI_API_KEY" },
      signIn: [],
    },
  ],
  models: [
    labModel,
    model(
      "anthropic",
      "claude-sonnet",
      "Claude Sonnet 4.5",
      ["off", "low", "medium", "high"],
      false,
    ),
    model("openai", "gpt", "GPT-5.1", ["minimal", "low", "medium", "high"], true),
    model("openai", "gpt-codex", "GPT-5.1 Codex", ["low", "medium", "high"], false),
  ],
} satisfies DesktopCatalog;
