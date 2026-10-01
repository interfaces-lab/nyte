import { SwitchField, type SwitchFieldProps } from "@nyte-ai/ui/switch";
import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";

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
      {...props(
        settingsPatterns.row,
        variant === "slider" && settingsPatterns.rowSlider,
        detail !== undefined && settingsPatterns.rowDetailed,
      )}
    >
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>{title}</span>
        <span {...props(settingsPatterns.rowDescription)}>{description}</span>
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
  return <SwitchField {...rest} label={title} xstyle={settingsPatterns.row} />;
}
