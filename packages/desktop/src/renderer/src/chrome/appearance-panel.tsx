/** Settings that affect the renderer's palette, typography, and conversation density. */
import { Slider } from "@nyte-ai/ui/slider";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import {
  codeFontFamily,
  localFontFamily,
  localFontSelection,
  setAppearanceSettings,
  systemReducesTransparency,
  uiFontFamily,
  type AppearanceSettings,
  type CodeFont,
  type ThemePreference,
  type ToolCallDensity,
  type UiFont,
} from "../theme/boot.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { appearancePanelStyles as styles } from "./appearance-panel.stylex.ts";
import { FontFamilySelect } from "./font-family-select.tsx";
import {
  CODE_FONT_CATALOG_TITLE,
  fontSelectGroups,
  UI_FONT_CATALOG_TITLE,
} from "./font-select-groups.ts";
import {
  SettingsRow,
  SettingsSelect,
  type SettingsSelectOption,
  SettingsStepper,
  SettingsSwitch,
} from "./settings-controls.tsx";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: ThemePreference; readonly label: string }[];

const UI_FONT_OPTIONS = [
  { value: "inter", label: "Inter", fontFamily: uiFontFamily("inter") },
  { value: "system", label: "System UI", fontFamily: uiFontFamily("system") },
] as const satisfies readonly SettingsSelectOption<UiFont>[];

const CODE_FONT_OPTIONS = [
  { value: "system", label: "System Mono", fontFamily: codeFontFamily("system") },
  {
    value: "jetbrains-mono",
    label: "JetBrains Mono",
    fontFamily: codeFontFamily("jetbrains-mono"),
  },
] as const satisfies readonly SettingsSelectOption<CodeFont>[];

const TOOL_CALL_DENSITIES = [
  "compact",
  "balanced",
  "detailed",
] as const satisfies readonly ToolCallDensity[];

const TOOL_CALL_DENSITY_LABELS = {
  compact: "Compact",
  balanced: "Balanced",
  detailed: "Detailed",
} as const satisfies Readonly<Record<ToolCallDensity, string>>;

function update(settings: AppearanceSettings, patch: Partial<AppearanceSettings>): void {
  setAppearanceSettings({ ...settings, ...patch });
}

function CodeFontPreview(): ReactElement {
  return (
    <div aria-label="Code and diff font preview" {...stylex.props(styles.codeFontPreview)}>
      <div {...stylex.props(styles.diffLine, styles.diffRemovedLine)}>
        <span {...stylex.props(styles.diffRemovedNumber)}>1</span>
        <code {...stylex.props(styles.codePreviewText)}>
          <span {...stylex.props(styles.codeKeyword)}>return</span> a + b;
        </code>
      </div>
      <div {...stylex.props(styles.diffLine, styles.diffAddedLine)}>
        <span {...stylex.props(styles.diffAddedNumber)}>1</span>
        <code {...stylex.props(styles.codePreviewText)}>
          <span {...stylex.props(styles.codeKeyword)}>const</span>{" "}
          <span {...stylex.props(styles.codeIdentifier)}>result</span> = a + b;
        </code>
      </div>
      <div {...stylex.props(styles.diffLine, styles.diffAddedLine)}>
        <span {...stylex.props(styles.diffAddedNumber)}>2</span>
        <code {...stylex.props(styles.codePreviewText)}>
          <span {...stylex.props(styles.codeKeyword)}>return</span>{" "}
          <span {...stylex.props(styles.codeIdentifier)}>result</span>;
        </code>
      </div>
    </div>
  );
}

function HueControl({
  value,
  active,
  onValueChange,
}: {
  readonly value: number;
  readonly active: boolean;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <span {...stylex.props(styles.tintControl)}>
      <Slider.Root
        min={0}
        max={360}
        step={1}
        value={value}
        thumbAlignment="edge"
        {...stylex.props(styles.tintSlider)}
        onValueChange={onValueChange}
      >
        <Slider.Control {...stylex.props(styles.sliderControl)}>
          <Slider.Track {...stylex.props(styles.sliderTrack)}>
            <Slider.Thumb
              aria-label="Tint hue"
              aria-valuetext={`${String(value)} degrees`}
              {...stylex.props(styles.sliderThumb, styles.tintThumb)}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span aria-hidden="true" {...stylex.props(styles.tintSlot)}>
        <span {...stylex.props(styles.tintSwatch, active && styles.tintSwatchActive)} />
      </span>
    </span>
  );
}

function IntensityControl({
  value,
  onValueChange,
}: {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <span {...stylex.props(styles.tintControl)}>
      <Slider.Root
        min={0}
        max={100}
        step={1}
        value={value}
        thumbAlignment="edge"
        {...stylex.props(styles.tintSlider)}
        onValueChange={onValueChange}
      >
        <Slider.Control {...stylex.props(styles.sliderControl)}>
          <Slider.Track {...stylex.props(styles.sliderTrack)}>
            <Slider.Thumb
              aria-label="Tint intensity"
              aria-valuetext={`${String(value)} percent`}
              {...stylex.props(styles.sliderThumb, styles.tintThumb)}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span {...stylex.props(styles.tintSlot)}>
        <span {...stylex.props(styles.tintValue)}>{value}%</span>
      </span>
    </span>
  );
}

function DensityControl({
  value,
  onValueChange,
}: {
  readonly value: ToolCallDensity;
  readonly onValueChange: (value: ToolCallDensity) => void;
}): ReactElement {
  const index = TOOL_CALL_DENSITIES.indexOf(value);

  return (
    <span {...stylex.props(styles.density)}>
      <Slider.Root
        min={0}
        max={TOOL_CALL_DENSITIES.length - 1}
        step={1}
        value={index}
        thumbAlignment="edge"
        {...stylex.props(styles.densitySlider)}
        onValueChange={(nextIndex) => {
          const next = TOOL_CALL_DENSITIES[nextIndex];

          if (next !== undefined) onValueChange(next);
        }}
      >
        <Slider.Control {...stylex.props(styles.sliderControl)}>
          <Slider.Track {...stylex.props(styles.sliderTrack)}>
            <span aria-hidden="true" {...stylex.props(styles.densityDetent)} />
            <Slider.Thumb
              aria-label="Conversation density"
              aria-valuetext={TOOL_CALL_DENSITY_LABELS[value]}
              {...stylex.props(styles.sliderThumb, styles.densityThumb)}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span aria-hidden="true" {...stylex.props(styles.densityLabels)}>
        <span>Compact</span>
        <span>Detailed</span>
      </span>
    </span>
  );
}

export function AppearanceSettings(): ReactElement {
  const settings = useAppearanceSettings();
  const fonts = useQuery({ queryKey: ["host", "fonts"], queryFn: () => nyte.host.fonts() });
  const systemTransparency = systemReducesTransparency();
  // `-webkit-font-smoothing` only does anything on macOS.
  const mac = macPlatform(undefined);

  const uiFontGroups = fontSelectGroups(
    UI_FONT_OPTIONS,
    fonts.data?.sans ?? [],
    localFontFamily(settings.uiFont),
    localFontSelection,
    uiFontFamily,
    UI_FONT_CATALOG_TITLE,
  );

  const codeFontGroups = fontSelectGroups(
    CODE_FONT_OPTIONS,
    fonts.data?.monospace ?? [],
    localFontFamily(settings.codeFont),
    localFontSelection,
    codeFontFamily,
    CODE_FONT_CATALOG_TITLE,
  );

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(settingsPatterns.group)}>
        <SettingsRow title="Theme" description="Choose between light and dark themes">
          <SettingsSelect<ThemePreference>
            label="Theme"
            value={settings.theme}
            options={THEME_OPTIONS}
            onValueChange={(theme) => update(settings, { theme })}
          />
        </SettingsRow>
      </div>

      <section {...stylex.props(settingsPatterns.section)}>
        <div {...stylex.props(settingsPatterns.sectionHeader)}>
          <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Agent Conversations</h2>
        </div>
        <div {...stylex.props(settingsPatterns.group)}>
          <SettingsRow
            title="Tool Call Density"
            description="Adjust how much detail is shown for tool calls"
            variant="slider"
          >
            <DensityControl
              value={settings.toolCalls}
              onValueChange={(toolCalls) => update(settings, { toolCalls })}
            />
          </SettingsRow>
          <SettingsRow
            title="Code Block Word Wrap"
            description="Wrap long lines in Agent conversation code blocks"
          >
            <SettingsSwitch
              label="Code Block Word Wrap"
              checked={settings.codeBlockWordWrap}
              onCheckedChange={(codeBlockWordWrap) => update(settings, { codeBlockWordWrap })}
            />
          </SettingsRow>
          <SettingsRow
            title="Themed Diff Backgrounds"
            description="Use themed background colors for inline code diffs"
          >
            <SettingsSwitch
              label="Themed Diff Backgrounds"
              checked={settings.themedDiffBackgrounds}
              onCheckedChange={(themedDiffBackgrounds) =>
                update(settings, { themedDiffBackgrounds })
              }
            />
          </SettingsRow>
        </div>
      </section>

      <section {...stylex.props(settingsPatterns.section)}>
        <div {...stylex.props(settingsPatterns.sectionHeader)}>
          <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Colors</h2>
        </div>
        <div {...stylex.props(settingsPatterns.group)}>
          <SettingsRow title="Hue" description="Choose a tint color">
            <HueControl
              value={settings.tintHue}
              active={settings.tintIntensity > 0}
              onValueChange={(tintHue) => update(settings, { tintHue })}
            />
          </SettingsRow>
          <SettingsRow title="Intensity" description="Control how strongly the tint is applied">
            <IntensityControl
              value={settings.tintIntensity}
              onValueChange={(tintIntensity) => update(settings, { tintIntensity })}
            />
          </SettingsRow>
          <SettingsRow
            title="Reduce Transparency"
            description="Replace translucent surfaces with opaque backgrounds"
          >
            <SettingsSwitch
              label="Reduce Transparency"
              checked={settings.reduceTransparency || systemTransparency}
              disabled={systemTransparency}
              title={
                systemTransparency
                  ? "Your system has Reduce Transparency turned on right now"
                  : undefined
              }
              onCheckedChange={(reduceTransparency) => update(settings, { reduceTransparency })}
            />
          </SettingsRow>
        </div>
      </section>

      <section {...stylex.props(settingsPatterns.section)}>
        <div {...stylex.props(settingsPatterns.sectionHeader)}>
          <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Typography</h2>
        </div>
        <div {...stylex.props(settingsPatterns.group)}>
          <SettingsRow title="UI Font Size" description="Font size for the Nyte user interface">
            <SettingsStepper
              label="UI Font Size"
              value={settings.uiFontSize}
              minimum={12}
              maximum={16}
              onValueChange={(uiFontSize) => update(settings, { uiFontSize })}
            />
          </SettingsRow>
          <SettingsRow title="Code Font Size" description="Font size for code editors and diffs">
            <SettingsStepper
              label="Code Font Size"
              value={settings.codeFontSize}
              minimum={11}
              maximum={15}
              onValueChange={(codeFontSize) => update(settings, { codeFontSize })}
            />
          </SettingsRow>
          <SettingsRow
            title="UI Font Family"
            description="Override the Nyte user interface typeface"
            controlWidth="wide"
          >
            <FontFamilySelect<UiFont>
              label="UI Font Family"
              value={settings.uiFont}
              groups={uiFontGroups}
              loading={fonts.isPending}
              onValueChange={(uiFont) => update(settings, { uiFont })}
            />
          </SettingsRow>
          <SettingsRow
            title="Code Font Family"
            description="Override the font for code editors and diffs"
            controlWidth="wide"
            detail={<CodeFontPreview />}
          >
            <FontFamilySelect<CodeFont>
              label="Code Font Family"
              value={settings.codeFont}
              groups={codeFontGroups}
              loading={fonts.isPending}
              onValueChange={(codeFont) => update(settings, { codeFont })}
            />
          </SettingsRow>
          {mac && (
            <SettingsRow title="Font Smoothing" description="Use native macOS font anti-aliasing">
              <SettingsSwitch
                label="Font Smoothing"
                checked={settings.fontSmoothing === "antialiased"}
                onCheckedChange={(antialiased) =>
                  update(settings, { fontSmoothing: antialiased ? "antialiased" : "auto" })
                }
              />
            </SettingsRow>
          )}
        </div>
      </section>
    </div>
  );
}
