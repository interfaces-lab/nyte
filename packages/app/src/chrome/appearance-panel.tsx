/** Settings that affect the renderer's palette, typography, and conversation density. */
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@nyte-ai/ui/number-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider, type SliderRootProps } from "@nyte-ai/ui/slider";
import { props } from "@stylexjs/stylex";
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
  type FontOption,
} from "./font-select-groups.ts";
import { SettingsRow, SettingsSwitchRow } from "./settings-controls.tsx";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: ThemePreference; readonly label: string }[];

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

function SettingsSlider({
  label,
  valueText,
  ...rest
}: Pick<SliderRootProps<number>, "max" | "value" | "onValueChange" | "xstyle"> & {
  readonly label: string;
  readonly valueText: string;
}): ReactElement {
  return (
    <Slider.Root {...rest}>
      <Slider.Control>
        <Slider.Track>
          <Slider.Thumb aria-label={label} aria-valuetext={valueText} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
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
    <span {...props(styles.tintControl)}>
      <SettingsSlider
        label="Tint hue"
        valueText={`${String(value)} degrees`}
        max={360}
        value={value}
        xstyle={styles.tintSlider}
        onValueChange={onValueChange}
      />
      <span {...props(styles.tintValue)}>{value}°</span>
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
    <span {...props(styles.tintControl)}>
      <SettingsSlider
        label="Tint intensity"
        valueText={`${String(value)} percent`}
        max={100}
        value={value}
        xstyle={styles.tintSlider}
        onValueChange={onValueChange}
      />
      <span {...props(styles.tintSlot)}>
        <span {...props(styles.tintValue)}>{value}%</span>
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
    <span {...props(styles.density)}>
      <SettingsSlider
        label="Conversation density"
        valueText={TOOL_CALL_DENSITY_LABELS[value]}
        max={TOOL_CALL_DENSITIES.length - 1}
        value={index}
        xstyle={styles.densitySlider}
        onValueChange={(nextIndex) => {
          const next = TOOL_CALL_DENSITIES[nextIndex];

          if (next !== undefined) onValueChange(next);
        }}
      />
      <span aria-hidden="true" {...props(styles.densityLabels)}>
        <span>{TOOL_CALL_DENSITY_LABELS[value]}</span>
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
    <div {...props(styles.root)}>
      <div {...props(settingsPatterns.group)}>
        <SettingsRow title="Theme" description="Choose between light and dark themes">
          <Select
            items={THEME_OPTIONS}
            value={settings.theme}
            onValueChange={(theme) => {
              if (theme !== null) update(settings, { theme });
            }}
          >
            <SelectTrigger aria-label="Theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsSwitchRow
          title="Use Pointer Cursors"
          description="Change the cursor to a pointer when hovering over any interactive elements"
          checked={settings.pointerCursors}
          onCheckedChange={(pointerCursors) => update(settings, { pointerCursors })}
        />
      </div>

      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>Agent Conversations</h2>
        </div>
        <div {...props(settingsPatterns.group)}>
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
          <SettingsSwitchRow
            title="Code Block Word Wrap"
            description="Wrap long lines in Agent conversation code blocks"
            checked={settings.codeBlockWordWrap}
            onCheckedChange={(codeBlockWordWrap) => update(settings, { codeBlockWordWrap })}
          />
        </div>
      </section>

      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>Colors</h2>
        </div>
        <div {...props(settingsPatterns.group)}>
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
          <SettingsSwitchRow
            title="Reduce Transparency"
            description="Replace translucent surfaces with opaque backgrounds"
            checked={settings.reduceTransparency || systemTransparency}
            disabled={systemTransparency}
            onCheckedChange={(reduceTransparency) => update(settings, { reduceTransparency })}
          />
        </div>
      </section>

      <section {...props(settingsPatterns.section)}>
        <div {...props(settingsPatterns.sectionHeader)}>
          <h2 {...props(settingsPatterns.sectionTitle)}>Typography</h2>
        </div>
        <div {...props(settingsPatterns.group)}>
          <SettingsRow title="UI Font Size" description="Font size for the Nyte user interface">
            <NumberField
              defaultValue={settings.uiFontSize}
              min={12}
              max={16}
              onValueCommitted={(uiFontSize) => {
                if (uiFontSize !== null) update(settings, { uiFontSize });
              }}
            >
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput aria-label="UI Font Size" />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
          </SettingsRow>
          <SettingsRow title="Code Font Size" description="Font size for code editors and diffs">
            <NumberField
              defaultValue={settings.codeFontSize}
              min={11}
              max={15}
              onValueCommitted={(codeFontSize) => {
                if (codeFontSize !== null) update(settings, { codeFontSize });
              }}
            >
              <NumberFieldGroup>
                <NumberFieldDecrement />
                <NumberFieldInput aria-label="Code Font Size" />
                <NumberFieldIncrement />
              </NumberFieldGroup>
            </NumberField>
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
            <SettingsSwitchRow
              title="Font Smoothing"
              description="Use native macOS font anti-aliasing"
              checked={settings.fontSmoothing === "antialiased"}
              onCheckedChange={(antialiased) =>
                update(settings, { fontSmoothing: antialiased ? "antialiased" : "auto" })
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
