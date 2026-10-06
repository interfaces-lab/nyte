/** Settings that affect the renderer's palette, typography, and conversation density. */
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Slider } from "@nyte-ai/ui/slider";
import { props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactElement } from "react";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { subscribeSystemTransparency, systemReducesTransparency } from "../theme/appearance.ts";
import {
  codeFontFamily,
  localFontFamily,
  localFontSelection,
  uiFontFamily,
  type CodeFont,
  type UiFont,
} from "../theme/fonts.ts";
import { appearanceStyles as styles } from "./appearance.stylex.ts";
import { FontFamilySelect } from "./font-family-select.tsx";
import {
  CODE_FONT_CATALOG_TITLE,
  fontSelectGroups,
  UI_FONT_CATALOG_TITLE,
  type FontOption,
} from "./font-select-groups.ts";
import {
  NumberRow,
  SelectRow,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
  StepsRow,
  SwitchRow,
} from "./rows.tsx";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const DENSITIES = [
  { value: "compact", label: "Compact" },
  { value: "balanced", label: "Balanced" },
  { value: "detailed", label: "Detailed" },
] as const;

const UI_FONT_OPTIONS = [
  { value: "inter", label: "Inter", fontFamily: uiFontFamily("inter") },
  { value: "system", label: "System UI", fontFamily: uiFontFamily("system") },
] as const satisfies readonly FontOption<UiFont>[];

const CODE_FONT_OPTIONS = [
  { value: "system", label: "System Mono", fontFamily: codeFontFamily("system") },
  {
    value: "jetbrains-mono",
    label: "JetBrains Mono",
    fontFamily: codeFontFamily("jetbrains-mono"),
  },
] as const satisfies readonly FontOption<CodeFont>[];

function CodeFontPreview(): ReactElement {
  return (
    <div aria-label="Code and diff font preview" {...props(styles.codeFontPreview)}>
      <div {...props(intent.danger, styles.diffLine, styles.diffRemovedLine)}>
        <span {...props(styles.diffRemovedNumber)}>1</span>
        <code {...props(styles.codePreviewText)}>
          <span {...props(surfaceTheme.purple, styles.codeKeyword)}>return</span> a + b;
        </code>
      </div>
      <div {...props(intent.success, styles.diffLine, styles.diffAddedLine)}>
        <span {...props(styles.diffAddedNumber)}>1</span>
        <code {...props(styles.codePreviewText)}>
          <span {...props(surfaceTheme.purple, styles.codeKeyword)}>const</span>{" "}
          <span {...props(surfaceTheme.blue, styles.codeIdentifier)}>result</span> = a + b;
        </code>
      </div>
      <div {...props(intent.success, styles.diffLine, styles.diffAddedLine)}>
        <span {...props(styles.diffAddedNumber)}>2</span>
        <code {...props(styles.codePreviewText)}>
          <span {...props(surfaceTheme.purple, styles.codeKeyword)}>return</span>{" "}
          <span {...props(surfaceTheme.blue, styles.codeIdentifier)}>result</span>;
        </code>
      </div>
    </div>
  );
}

function TintSlider({
  label,
  valueText,
  max,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly valueText: string;
  readonly max: number;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <Slider.Root max={max} value={value} xstyle={styles.tintSlider} onValueChange={onValueChange}>
      <Slider.Control>
        <Slider.Track>
          <Slider.Thumb aria-label={label} aria-valuetext={valueText} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

function HueRow(): ReactElement {
  const hue = useSetting(preferences.tintHue);
  const active = useSetting(preferences.tintIntensity) > 0;

  return (
    <SettingsRow title="Hue" description="Tint backgrounds and surfaces toward one color">
      <span {...props(styles.tintControl)}>
        <TintSlider
          label="Tint hue"
          valueText={`${String(hue)} degrees`}
          max={360}
          value={hue}
          onValueChange={(next) => preferences.tintHue.set(next)}
        />
        <span aria-hidden="true" {...props(styles.tintSlot)}>
          <span
            {...props(
              active && surfaceTheme.custom,
              styles.tintSwatch,
              active && styles.tintSwatchActive,
            )}
          />
        </span>
      </span>
    </SettingsRow>
  );
}

function IntensityRow(): ReactElement {
  const intensity = useSetting(preferences.tintIntensity);

  return (
    <SettingsRow
      title="Intensity"
      description="How strongly the tint shows. All the way left turns it off"
    >
      <span {...props(styles.tintControl)}>
        <TintSlider
          label="Tint intensity"
          valueText={`${String(intensity)} percent`}
          max={100}
          value={intensity}
          onValueChange={(next) => preferences.tintIntensity.set(next)}
        />
        <span aria-hidden="true" {...props(styles.tintSlot)} />
      </span>
    </SettingsRow>
  );
}

function ReduceTransparencyRow(): ReactElement {
  const reduced = useSetting(preferences.reduceTransparency);

  const system = useSyncExternalStore(
    subscribeSystemTransparency,
    systemReducesTransparency,
    systemReducesTransparency,
  );

  return (
    <SettingsSwitchRow
      title="Reduce transparency"
      description={
        system
          ? "Turned on in your system settings"
          : "Replace translucent surfaces with opaque backgrounds"
      }
      checked={reduced || system}
      disabled={system}
      onCheckedChange={(next) => preferences.reduceTransparency.set(next)}
    />
  );
}

function FontFamilyRows(): ReactElement {
  const uiFont = useSetting(preferences.uiFont);
  const codeFont = useSetting(preferences.codeFont);
  const fonts = useQuery({ queryKey: ["host", "fonts"], queryFn: () => nyte.host.fonts() });

  const uiFontGroups = fontSelectGroups(
    UI_FONT_OPTIONS,
    fonts.data?.sans ?? [],
    localFontFamily(uiFont),
    localFontSelection,
    uiFontFamily,
    UI_FONT_CATALOG_TITLE,
  );

  const codeFontGroups = fontSelectGroups(
    CODE_FONT_OPTIONS,
    fonts.data?.monospace ?? [],
    localFontFamily(codeFont),
    localFontSelection,
    codeFontFamily,
    CODE_FONT_CATALOG_TITLE,
  );

  return (
    <>
      <SettingsRow
        title="UI font family"
        description="Text in menus, chat, and labels"
        controlWidth="wide"
      >
        <FontFamilySelect<UiFont>
          label="UI font family"
          value={uiFont}
          groups={uiFontGroups}
          loading={fonts.isPending}
          onValueChange={(next) => preferences.uiFont.set(next)}
        />
      </SettingsRow>
      <SettingsRow
        title="Code font family"
        description="Code in chat, editors, diffs, and the terminal"
        controlWidth="wide"
        detail={<CodeFontPreview />}
      >
        <FontFamilySelect<CodeFont>
          label="Code font family"
          value={codeFont}
          groups={codeFontGroups}
          loading={fonts.isPending}
          onValueChange={(next) => preferences.codeFont.set(next)}
        />
      </SettingsRow>
    </>
  );
}

function FontSmoothingRow(): ReactElement | null {
  const smoothing = useSetting(preferences.fontSmoothing);

  // `-webkit-font-smoothing` only does anything on macOS.
  if (!macPlatform(undefined)) return null;

  return (
    <SettingsSwitchRow
      title="Font smoothing"
      description="Grayscale anti-aliasing. Text renders thinner and lighter"
      checked={smoothing === "antialiased"}
      onCheckedChange={(antialiased) =>
        preferences.fontSmoothing.set(antialiased ? "antialiased" : "auto")
      }
    />
  );
}

export function AppearanceSettings(): ReactElement {
  return (
    <>
      <SettingsSection>
        <SelectRow
          setting={preferences.theme}
          title="Theme"
          description="Follow the system, or always use light or dark"
          options={THEMES}
        />
        <SwitchRow
          setting={preferences.pointerCursors}
          title="Use pointer cursors"
          description="Show a hand cursor over buttons, rows, and links"
        />
      </SettingsSection>
      <SettingsSection title="Agent conversations">
        <StepsRow
          setting={preferences.toolCalls}
          title="Tool call density"
          description="Compact previews the step that's running. Detailed keeps finished steps open"
          options={DENSITIES}
        />
        <SwitchRow
          setting={preferences.codeBlockWordWrap}
          title="Code block word wrap"
          description="Wrap long lines in chat code blocks instead of scrolling sideways"
        />
      </SettingsSection>
      <SettingsSection title="Colors">
        <HueRow />
        <IntensityRow />
        <ReduceTransparencyRow />
      </SettingsSection>
      <SettingsSection title="Typography">
        <NumberRow
          setting={preferences.uiFontSize}
          title="UI font size"
          description="Text in menus, chat, and labels, in pixels"
          min={12}
          max={16}
        />
        <NumberRow
          setting={preferences.codeFontSize}
          title="Code font size"
          description="Code in chat, editors, diffs, and the terminal, in pixels"
          min={11}
          max={15}
        />
        <FontFamilyRows />
        <FontSmoothingRow />
      </SettingsSection>
    </>
  );
}
