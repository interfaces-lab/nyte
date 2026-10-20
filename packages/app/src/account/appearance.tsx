import type { ClerkProviderProps } from "@clerk/react";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

const styles = create({
  title: { "--_title": role.contentPrimary },
  accent: {
    "--_accent-fill": role.buttonFill,
    "--_accent-content": role.contentOnInteractiveStrong,
  },
});

export const accountAppearance = {
  theme: "simple",
  variables: {
    colorPrimary: "var(--_accent-fill)",
    colorPrimaryForeground: "var(--_accent-content)",
    colorNeutral: "var(--nyte-content-primary)",
    colorForeground: "var(--nyte-content-primary)",
    colorBackground: "var(--nyte-bg-elevated)",
    colorMuted: "var(--nyte-bg-muted)",
    colorMutedForeground: "var(--nyte-content-secondary)",
    colorInput: "var(--nyte-bg-base)",
    colorInputForeground: "var(--nyte-content-primary)",
    colorRing: "var(--nyte-content-primary)",
    borderRadius: "var(--nyte-shape-control)",
    fontSize: "var(--nyte-font-size-base)",
  },
  options: { elevation: "flush", socialButtonsVariant: "blockButton" },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%" },
    headerTitle: {
      fontSize: "var(--nyte-font-size-lg)",
      lineHeight: "var(--nyte-line-height-lg)",
      fontWeight: "var(--nyte-font-weight-semibold)",
      color: "var(--_title)",
    },
    buttonArrowIcon: { display: "none" },
    formFieldInput: { height: "var(--nyte-input-height-md)", paddingBlock: 0 },
    formButtonPrimary: { height: "var(--nyte-btn-height-md)", paddingBlock: 0 },
    socialButtonsBlockButton: { height: "var(--nyte-btn-height-md)", paddingBlock: 0 },
  },
} satisfies NonNullable<ClerkProviderProps["appearance"]>;

export function AccountScope({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div {...props(styles.title)}>
      <div {...props(intent.primary, styles.accent)}>
        <div {...props(surfaceTheme.gray)}>{children}</div>
      </div>
    </div>
  );
}
