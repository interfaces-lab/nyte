import { tinted } from "./styles/roles.stylex.ts";
import {
  blue,
  brown,
  custom,
  gray,
  green,
  orange,
  pink,
  purple,
  red,
  teal,
  yellow,
} from "./styles/theme.stylex.ts";

export const surfaceTheme = {
  gray: [gray, tinted],
  brown: [brown, tinted],
  orange: [orange, tinted],
  yellow: [yellow, tinted],
  green: [green, tinted],
  blue: [blue, tinted],
  purple: [purple, tinted],
  pink: [pink, tinted],
  red: [red, tinted],
  teal: [teal, tinted],
  custom: [custom, tinted],
} as const;

export type Tint = keyof typeof surfaceTheme;

export const intent = {
  primary: surfaceTheme.blue,
  success: surfaceTheme.green,
  warning: surfaceTheme.yellow,
  danger: surfaceTheme.red,
} as const;
