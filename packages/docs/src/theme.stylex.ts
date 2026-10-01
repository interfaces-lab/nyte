import { createTheme } from "@stylexjs/stylex";
import { typography } from "@nyte-ai/ui/tokens.stylex";

export const siteTypography = createTheme(typography, {
  "--nyte-ui-font-inter": "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
});
