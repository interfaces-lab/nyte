import { NumberField } from "@nyte-ai/ui/number-field";
import { Select } from "@nyte-ai/ui/select";
import { Switch } from "@nyte-ai/ui/switch";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "../components/icons.tsx";
import { overlayRef } from "../components/overlay-occlusion.ts";
import { focus } from "../components/ui.tsx";
import { settingsPatterns as styles } from "../theme/settings-patterns.stylex.ts";

const SELECT_COLLISION: NonNullable<Select.Positioner.Props["collisionAvoidance"]> = {
  side: "flip",
  align: "shift",
  fallbackAxisSide: "none",
};

export function SettingsRow({
  title,
  description,
  variant = "standard",
  controlWidth = "standard",
  detail,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly variant?: "standard" | "slider";
  readonly controlWidth?: "standard" | "wide";
  readonly detail?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      {...stylex.props(
        styles.row,
        variant === "slider" && styles.rowSlider,
        detail !== undefined && styles.rowDetailed,
      )}
    >
      <span {...stylex.props(styles.rowCopy)}>
        <span {...stylex.props(styles.rowTitle)}>{title}</span>
        <span {...stylex.props(styles.rowDescription)}>{description}</span>
      </span>
      <span {...stylex.props(styles.rowControl, controlWidth === "wide" && styles.rowControlWide)}>
        {children}
      </span>
      {detail !== undefined && <div {...stylex.props(styles.rowDetail)}>{detail}</div>}
    </div>
  );
}

export interface SettingsSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Dynamic because installed family names cannot be compiled into StyleX. */
  readonly fontFamily?: string;
}

export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  disabled = false,
  width = "standard",
  onValueChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SettingsSelectOption<T>[];
  readonly disabled?: boolean;
  readonly width?: "standard" | "wide";
  readonly onValueChange: (value: T) => void;
}): ReactElement {
  const selected = options.find((option) => option.value === value);

  return (
    <Select.Root<T>
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(candidate) => {
        if (candidate === null) return;
        const option = options.find((entry) => entry.value === candidate);
        if (option !== undefined) onValueChange(option.value);
      }}
    >
      <Select.Trigger
        type="button"
        aria-label={label}
        {...stylex.props(
          styles.selectTrigger,
          width === "wide" && styles.selectTriggerWide,
          focus.ring,
        )}
      >
        <Select.Value {...stylex.props(styles.selectValue)}>
          {selected?.label ?? value}
        </Select.Value>
        <Select.Icon {...stylex.props(styles.selectIcon)}>
          <Icon name="chevron-down" size={11} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={SELECT_COLLISION}
          alignItemWithTrigger={false}
          {...stylex.props(styles.selectPositioner)}
        >
          <Select.Popup ref={overlayRef} {...stylex.props(styles.selectPopup)}>
            <Select.List {...stylex.props(styles.selectList)}>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  {...stylex.props(styles.selectItem)}
                >
                  <Select.ItemText
                    style={
                      option.fontFamily === undefined
                        ? undefined
                        : { fontFamily: option.fontFamily }
                    }
                    {...stylex.props(styles.selectItemText)}
                  >
                    {option.label}
                  </Select.ItemText>
                  <Select.ItemIndicator {...stylex.props(styles.selectItemIndicator)}>
                    <Icon name="checkmark" size={11} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function SettingsSwitch({
  label,
  checked,
  disabled = false,
  title,
  onCheckedChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onCheckedChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <Switch.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      title={title}
      onCheckedChange={onCheckedChange}
      {...stylex.props(
        styles.switchTrack,
        focus.ring,
        checked && styles.switchTrackOn,
        disabled && styles.switchTrackDisabled,
      )}
    >
      <Switch.Thumb {...stylex.props(styles.switchThumb, checked && styles.switchThumbOn)} />
    </Switch.Root>
  );
}

export function SettingsStepper({
  label,
  value,
  minimum,
  maximum,
  onValueChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly onValueChange: (value: number) => void;
}): ReactElement {
  return (
    <NumberField.Root
      value={value}
      min={minimum}
      max={maximum}
      step={1}
      onValueChange={(candidate) => {
        if (candidate !== null) onValueChange(candidate);
      }}
      {...stylex.props(styles.stepper)}
    >
      <NumberField.Decrement
        type="button"
        aria-label={`Decrease ${label.toLocaleLowerCase()}`}
        {...stylex.props(styles.stepperButton, styles.stepperSplit)}
      >
        −
      </NumberField.Decrement>
      <NumberField.Input
        aria-label={label}
        {...stylex.props(styles.stepperValue, styles.stepperSplit)}
      />
      <NumberField.Increment
        type="button"
        aria-label={`Increase ${label.toLocaleLowerCase()}`}
        {...stylex.props(styles.stepperButton)}
      >
        +
      </NumberField.Increment>
    </NumberField.Root>
  );
}
