/**
 * Scopes. A scope pairs a hue theme with the tinted roles, so everything
 * inside reads that hue: pass `surfaceTheme.blue` or `intent.danger` to
 * `props()` on the element that starts it. Both halves are needed: a role
 * resolved at <html> stays gray below a hue theme alone.
 */
import { tinted } from "./roles.stylex.ts";
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
} from "./theme.stylex.ts";

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

/** Control intents select a hue by meaning. */
export const intent = {
  primary: surfaceTheme.blue,
  success: surfaceTheme.green,
  warning: surfaceTheme.yellow,
  danger: surfaceTheme.red,
} as const;
