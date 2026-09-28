import * as stylex from "@stylexjs/stylex";
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
      {...stylex.props(
        settingsPatterns.row,
        variant === "slider" && settingsPatterns.rowSlider,
        detail !== undefined && settingsPatterns.rowDetailed,
      )}
    >
      <span {...stylex.props(settingsPatterns.rowCopy)}>
        <span {...stylex.props(settingsPatterns.rowTitle)}>{title}</span>
        <span {...stylex.props(settingsPatterns.rowDescription)}>{description}</span>
      </span>
      <span
        {...stylex.props(
          settingsPatterns.rowControl,
          controlWidth === "wide" && settingsPatterns.rowControlWide,
        )}
      >
        {children}
      </span>
      {detail !== undefined && <div {...stylex.props(settingsPatterns.rowDetail)}>{detail}</div>}
    </div>
  );
}
