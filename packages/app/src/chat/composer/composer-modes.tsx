import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import type { SettingInfo, SettingTint } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { ICON_NAMES, Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { connection } from "../../data/connection.ts";

const RAMP_PEAK_CHROMA = 0.1317;

interface ComposerMode {
  readonly id: string;
  readonly title: string;
  readonly on: boolean;
  readonly icon: IconName | null;
  readonly tint: SettingTint | null;
}

export interface ComposerModes {
  readonly on: readonly ComposerMode[];
  readonly cycle: (() => void) | undefined;
  readonly turnOff: (mode: ComposerMode) => void;
}

const styles = create({
  tint: (hue: number, chroma: number) => ({
    "--nyte-custom-hue": hue,
    "--nyte-custom-chroma-scale": chroma,
  }),
});

export function useComposerModes(
  sessionId: SessionId,
  settings: readonly SettingInfo[] | undefined,
): ComposerModes {
  const modes = (settings ?? []).flatMap((setting): ComposerMode[] =>
    setting.mode === undefined
      ? []
      : [
          {
            id: setting.id,
            title: setting.title,
            on: setting.value === true,
            icon: ICON_NAMES.find((name) => name === setting.mode?.icon) ?? null,
            tint: setting.mode.tint ?? null,
          },
        ],
  );

  const apply = (values: Readonly<Record<string, boolean>>): void =>
    void connection()
      .session(sessionId)
      .configure({ settings: values })
      .then((outcome) => {
        if (outcome.kind !== "configured") throw new Error(outcome.kind);
      })
      .catch(() =>
        toast.add({
          type: "error",
          title: "Couldn't change the mode. Try again.",
          id: "composer-mode-error",
        }),
      );

  return {
    on: modes.filter((mode) => mode.on),
    cycle: modes.length === 0 ? undefined : () => apply(nextModes(modes)),
    turnOff: (mode) => apply({ [mode.id]: false }),
  };
}

export function ModeChips({ modes }: { readonly modes: ComposerModes }): ReactElement {
  return (
    <>
      {modes.on.map((mode) => (
        <span
          key={mode.id}
          {...props(
            mode.tint !== null && surfaceTheme.custom,
            mode.tint !== null &&
              styles.tint(mode.tint.hue, Math.min(1, mode.tint.chroma / RAMP_PEAK_CHROMA)),
          )}
        >
          <Button
            size="sm"
            aria-pressed
            aria-keyshortcuts="Shift+Tab"
            aria-description={`${mode.title} is on. Press to turn it off.`}
            onClick={() => modes.turnOff(mode)}
          >
            {mode.icon !== null && <Icon name={mode.icon} size="xs" />}
            {mode.title}
          </Button>
        </span>
      ))}
    </>
  );
}

function nextModes(modes: readonly ComposerMode[]): Readonly<Record<string, boolean>> {
  const current = modes.findIndex((mode) => mode.on);
  const next = current === modes.length - 1 ? -1 : current + 1;

  return Object.fromEntries(modes.map((mode, index) => [mode.id, index === next]));
}
