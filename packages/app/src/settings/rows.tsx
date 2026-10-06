/**
 * Settings rows. The layout primitives (`SettingsSection`, `SettingsRow`,
 * `SettingsSwitchRow`) draw the card and its rows; the bound rows take a
 * `Setting` handle and required copy, and render nothing where this host
 * can't back the value. A section with nothing rendered inside hides itself.
 */
import { Input } from "@nyte-ai/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider } from "@nyte-ai/ui/slider";
import { SwitchField, type SwitchFieldProps } from "@nyte-ai/ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@nyte-ai/ui/number-field";
import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { useSetting, type Setting } from "../preferences/index.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { available, type Capability } from "./pages.ts";
import { settingsStyles } from "./settings.stylex.ts";

/** Marks a rendered row, so an empty card can hide itself. */
const ROW_MARK = { "data-settings-row": "" } as const;

/** A small title over one card of rows. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section {...props(settingsPatterns.section, settingsStyles.section)}>
      {(title !== undefined || description !== undefined) && (
        <div {...props(settingsPatterns.sectionHeader)}>
          {title !== undefined && <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>}
          {description !== undefined && (
            <p {...props(settingsPatterns.sectionDescription)}>{description}</p>
          )}
        </div>
      )}
      <div {...props(settingsPatterns.group)}>{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  controlWidth = "standard",
  detail,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly controlWidth?: "standard" | "wide";
  readonly detail?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      {...ROW_MARK}
      {...props(settingsPatterns.row, detail !== undefined && settingsPatterns.rowDetailed)}
    >
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{title}</span>
        {description !== undefined && (
          <span {...props(settingsPatterns.rowDescription)}>{description}</span>
        )}
      </span>
      <span
        {...props(
          settingsPatterns.rowControl,
          controlWidth === "wide" && settingsPatterns.rowControlWide,
        )}
      >
        {children}
      </span>
      {detail !== undefined && <div {...props(settingsPatterns.rowDetail)}>{detail}</div>}
    </div>
  );
}

export function SettingsSwitchRow({
  title,
  ...rest
}: Omit<SwitchFieldProps, "label" | "xstyle"> & { readonly title: string }): ReactElement {
  return <SwitchField {...rest} {...ROW_MARK} label={title} xstyle={settingsPatterns.row} />;
}

interface Copy {
  readonly title: string;
  readonly description: string;
}

interface Bound<T> extends Copy {
  readonly setting: Setting<T>;
  /** Beyond what the setting itself needs. */
  readonly needs?: readonly Capability[];
}

function hidden<T>(input: Bound<T>): boolean {
  return !input.setting.available() || !available(input.needs ?? []);
}

export function SwitchRow(input: Bound<boolean>): ReactElement | null {
  const value = useSetting(input.setting);

  if (hidden(input)) return null;

  return (
    <SettingsSwitchRow
      title={input.title}
      description={input.description}
      checked={value ?? false}
      disabled={value === undefined}
      onCheckedChange={(checked) => input.setting.set(checked)}
    />
  );
}

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function SelectRow<T extends string>(
  input: Bound<T> & {
    readonly options: readonly [Option<NoInfer<T>>, ...Option<NoInfer<T>>[]];
    readonly controlWidth?: "standard" | "wide";
  },
): ReactElement | null {
  const value = useSetting(input.setting);

  if (hidden(input)) return null;

  return (
    <SettingsRow
      title={input.title}
      description={input.description}
      controlWidth={input.controlWidth}
    >
      <Select
        items={input.options}
        value={value ?? null}
        disabled={value === undefined}
        onValueChange={(next) => {
          if (next !== null) input.setting.set(next);
        }}
      >
        <SelectTrigger
          aria-label={input.title}
          width={input.controlWidth === "wide" ? "wide" : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {input.options.map((option) => (
            <SelectItem key={option.value} value={option.value} label={option.label}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

/** min, max, and step bound the control; the setting's schema bounds what is stored. */
export function NumberRow(
  input: Bound<number> & { readonly min: number; readonly max: number; readonly step?: number },
): ReactElement | null {
  const value = useSetting(input.setting);

  if (hidden(input)) return null;

  return (
    <SettingsRow title={input.title} description={input.description}>
      <NumberField
        // Keyed by the value, so a change from another window remounts the field.
        key={value}
        defaultValue={value}
        min={input.min}
        max={input.max}
        step={input.step}
        disabled={value === undefined}
        onValueCommitted={(next) => {
          if (next !== null) input.setting.set(next);
        }}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label={input.title} />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </SettingsRow>
  );
}

/** A slider over ordered options, labelled at both ends. */
export function StepsRow<T extends string>(
  input: Bound<T> & {
    readonly options: readonly [Option<NoInfer<T>>, Option<NoInfer<T>>, ...Option<NoInfer<T>>[]];
  },
): ReactElement | null {
  const value = useSetting(input.setting);

  if (hidden(input)) return null;

  const index = Math.max(
    0,
    input.options.findIndex((option) => option.value === value),
  );

  const first = input.options[0];
  const last = input.options[input.options.length - 1] ?? first;

  return (
    <SettingsRow title={input.title} description={input.description}>
      <span {...props(settingsStyles.steps)}>
        <Slider.Root
          max={input.options.length - 1}
          value={index}
          disabled={value === undefined}
          xstyle={settingsStyles.stepsSlider}
          onValueChange={(nextIndex) => {
            const next = input.options[nextIndex];

            if (next !== undefined) input.setting.set(next.value);
          }}
        >
          <Slider.Control>
            <Slider.Track>
              <Slider.Thumb aria-label={input.title} aria-valuetext={input.options[index]?.label} />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
        <span aria-hidden="true" {...props(settingsStyles.stepsLabels)}>
          <span>{first.label}</span>
          <span>{last.label}</span>
        </span>
      </span>
    </SettingsRow>
  );
}

/** Free text, saved on blur. Empty saves null: the built-in choice. */
export function TextRow(
  input: Bound<string | null> & {
    readonly placeholder: string;
    readonly type?: "text" | "url";
  },
): ReactElement | null {
  const value = useSetting(input.setting);

  if (hidden(input)) return null;

  return (
    <SettingsRow title={input.title} description={input.description} controlWidth="wide">
      <Input
        // Keyed by the value, so a change from another window replaces the draft.
        key={value ?? ""}
        type={input.type ?? "text"}
        aria-label={input.title}
        placeholder={input.placeholder}
        defaultValue={value ?? ""}
        disabled={value === undefined}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();

          if (next !== (value ?? "")) input.setting.set(next === "" ? null : next);
        }}
      />
    </SettingsRow>
  );
}
