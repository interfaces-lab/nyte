import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import type { SettingInfo, SettingTint } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { ICON_NAMES, Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@nyte-ai/ui/menu";
import type { IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { useConfigureSession, useSessionChoice } from "../../data/sessions.ts";

const RAMP_PEAK_CHROMA = 0.1317;

export interface ComposerMode {
  readonly id: string;
  readonly title: string;
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
            on: chosen[setting.id] ?? setting.value === true,
            icon: ICON_NAMES.find((name) => name === setting.mode?.icon) ?? null,
            tint: setting.mode.tint ?? null,
          },
        ],
  );
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

const NO_MODE = "none";

/** The mode control: the active mode, or Mode when none is on, opening every mode to pick from. Undefined with no modes. */
export function modeControl(modes: ComposerModes): ReactElement | undefined {
  if (modes.modes.length === 0) return undefined;
  const active = modes.modes.find((mode) => mode.on);
  const tint = active?.tint ?? null;

  const choose = (value: unknown): void =>
    modes.set(Object.fromEntries(modes.modes.map((mode) => [mode.id, mode.id === value])));

  return (
    <span
      {...props(
        tint !== null && surfaceTheme.custom,
        tint !== null && styles.tint(tint.hue, Math.min(1, tint.chroma / RAMP_PEAK_CHROMA)),
      )}
    >
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant={active === undefined ? "ghost" : "soft"}
              size="sm"
              pill
              aria-keyshortcuts="Shift+Tab"
              title={active === undefined ? "Choose a mode" : `${active.title} mode`}
            >
              {active !== undefined && active.icon !== null && (
                <Icon name={active.icon} size="xs" />
              )}
              <span {...props(styles.label)}>{active?.title ?? "Mode"}</span>
              <Icon name="chevron-down" size="2xs" />
            </Button>
          }
        />
        <MenuContent side="top" align="start">
          <MenuRadioGroup value={active?.id ?? NO_MODE} onValueChange={choose}>
            <MenuRadioItem value={NO_MODE}>No mode</MenuRadioItem>
            {modes.modes.map((mode) => (
              <MenuRadioItem key={mode.id} value={mode.id} icon={mode.icon ?? undefined}>
                {mode.title}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
    </span>
  );
}

function nextModes(modes: readonly ComposerMode[]): Readonly<Record<string, boolean>> {
  const current = modes.findIndex((mode) => mode.on);
  const next = current === modes.length - 1 ? -1 : current + 1;

  return Object.fromEntries(modes.map((mode, index) => [mode.id, index === next]));
}
