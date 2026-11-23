import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { CommandInfo, SessionId } from "@nyte-ai/sdk";
import type { SettingInfo, SettingTint } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { ICON_NAMES, Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { useConfigureSession, useSessionChoice } from "../../data/sessions.ts";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { parsePluginCommand } from "./plugin-command.ts";

const RAMP_PEAK_CHROMA = 0.1317;

interface ComposerMode {
  readonly id: string;
  readonly title: string;
  readonly trigger: string;
  readonly on: boolean;
  readonly icon: IconName | null;
  readonly tint: SettingTint | null;
}

export interface ComposerModes {
  readonly modes: readonly ComposerMode[];
  readonly set: (values: Readonly<Record<string, boolean>>) => void;
}

const styles = create({
  label: { display: { default: "inline", "@container (max-width: 400px)": "none" } },
  tint: (hue: number, chroma: number) => ({
    "--nyte-custom-hue": hue,
    "--nyte-custom-chroma-scale": chroma,
  }),
});

export function readModes(
  settings: readonly SettingInfo[] | undefined,
  chosen: Readonly<Record<string, boolean>> = {},
): readonly ComposerMode[] {
  return (settings ?? []).flatMap((setting): ComposerMode[] =>
    setting.mode === undefined
      ? []
      : [
          {
            id: setting.id,
            title: setting.title,
            trigger: setting.title.toLocaleLowerCase().replaceAll(/\s+/gu, "-"),
            on: chosen[setting.id] ?? setting.value === true,
            icon: ICON_NAMES.find((name) => name === setting.mode?.icon) ?? null,
            tint: setting.mode.tint ?? null,
          },
        ],
  );
}

/**
 * Each mode's trigger word, /debug for Debug, as a command the composer runs itself, as it runs
 * /compact. A plugin command of the same name keeps the word.
 */
export function modeTriggers(
  modes: ComposerModes,
  commands: readonly CommandInfo[],
): readonly CommandInfo[] {
  const taken = new Set(commands.map((command) => command.name));

  return modes.modes.flatMap((mode) => {
    if (taken.has(mode.trigger)) return [];
    taken.add(mode.trigger);

    return [
      {
        name: mode.trigger,
        owner: "",
        side: "client" as const,
        title: mode.title,
        description: `Turn ${mode.title} mode on or off`,
        takesText: false,
        completes: false,
      },
    ];
  });
}

/**
 * Runs a trigger word the composer starts with: its mode turns on alone, or off when it was on, and
 * the word leaves the composer while what was typed after it stays. Answers whether it ran.
 */
export function runModeTrigger(input: {
  readonly modes: ComposerModes;
  readonly triggers: readonly CommandInfo[];
  readonly editor: ComposerEditorHandle | null | undefined;
  readonly text: string;
}): boolean {
  const name = parsePluginCommand(input.text, input.triggers)?.name;
  const picked = input.modes.modes.find((mode) => mode.trigger === name);

  if (name === undefined || picked === undefined) return false;
  input.modes.set(
    Object.fromEntries(
      input.modes.modes.map((mode) => [mode.id, mode.id === picked.id && !picked.on]),
    ),
  );
  const start = input.text.indexOf("/");
  const word = input.text.slice(start).match(/^\/\S+\s*/u)?.[0].length ?? 0;
  input.editor?.replaceText(0, start + word, "");

  return true;
}

export function useSessionModes(
  sessionId: SessionId,
  settings: readonly SettingInfo[] | undefined,
): ComposerModes {
  const choice = useSessionChoice(sessionId);
  const configure = useConfigureSession(sessionId);

  const chosen = Object.fromEntries(
    Object.entries(choice?.settings ?? {}).flatMap(([id, value]) =>
      typeof value === "boolean" ? [[id, value]] : [],
    ),
  );

  return {
    modes: readModes(settings, chosen),
    set: (values) =>
      configure.mutate(
        { settings: values },
        {
          onError: () =>
            toast.add({
              type: "error",
              title: "Couldn't change the mode. Try again.",
              id: "composer-mode-error",
            }),
        },
      ),
  };
}

/** The composer's Shift+Tab: off, then each mode in turn, with the others off. Undefined with no modes. */
export function cycleModes(modes: ComposerModes): (() => void) | undefined {
  return modes.modes.length === 0 ? undefined : () => modes.set(nextModes(modes.modes));
}

/** The active mode as a chip that turns it off; undefined while no mode is on, since Shift+Tab picks one. */
export function modeControl(modes: ComposerModes): ReactElement | undefined {
  const active = modes.modes.find((mode) => mode.on);

  if (active === undefined) return undefined;
  const tint = active.tint;

  return (
    <span
      {...props(
        tint !== null && surfaceTheme.custom,
        tint !== null && styles.tint(tint.hue, Math.min(1, tint.chroma / RAMP_PEAK_CHROMA)),
      )}
    >
      <Button
        variant="soft"
        size="sm"
        pill
        aria-pressed
        aria-keyshortcuts="Shift+Tab"
        title={`Turn off ${active.title}`}
        onClick={() => modes.set({ [active.id]: false })}
      >
        {active.icon !== null && <Icon name={active.icon} size="xs" />}
        <span {...props(styles.label)}>{active.title}</span>
      </Button>
    </span>
  );
}

function nextModes(modes: readonly ComposerMode[]): Readonly<Record<string, boolean>> {
  const current = modes.findIndex((mode) => mode.on);
  const next = current === modes.length - 1 ? -1 : current + 1;

  return Object.fromEntries(modes.map((mode, index) => [mode.id, index === next]));
}
