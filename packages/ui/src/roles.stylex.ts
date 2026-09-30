/**
 * The roles: Notion Calendar's colour roles, each a light and a dark step
 * through `light-dark()`, which follows `color-scheme`. These are the neutral
 * values, except that readable text takes the nearest step reaching 4.5:1 on
 * the base, chrome, and elevated surfaces, and interactive glyphs the nearest
 * reaching 3:1. `surface-theme.ts` re-declares the
 * scoped subset from the theme
 * layer, and because a theme class re-declares this whole group on its
 * element, everything defined here re-resolves inside a scope. Hover and
 * pressed carry Notion's multipliers inline: a number cannot switch through
 * `light-dark()`.
 */
import { defineVars } from "@stylexjs/stylex";

import "./ramps.stylex.ts";
import "./theme.stylex.ts";

export const roles = defineVars({
  "--nyte-content-primary": "light-dark(var(--nyte-gray-130), var(--nyte-gray-30))",
  "--nyte-content-secondary": "light-dark(var(--nyte-gray-100), var(--nyte-gray-70))",
  "--nyte-content-tertiary": "light-dark(var(--nyte-gray-70), var(--nyte-gray-100))",
  "--nyte-content-disabled": "light-dark(var(--nyte-gray-40), var(--nyte-gray-120))",
  "--nyte-content-chrome": "light-dark(var(--nyte-gray-100), var(--nyte-gray-60))",
  "--nyte-content-interactive-primary": "light-dark(var(--nyte-gray-120), var(--nyte-gray-20))",
  "--nyte-content-disabled-translucent":
    "light-dark(var(--nyte-translucent-gray-40), var(--nyte-translucent-gray-120))",
  "--nyte-content-interactive-secondary": "light-dark(var(--nyte-gray-100), var(--nyte-gray-50))",
  "--nyte-content-interactive-tertiary": "light-dark(var(--nyte-gray-80), var(--nyte-gray-90))",
  "--nyte-content-on-interactive-strong": "var(--nyte-gray-0)",
  "--nyte-content-on-control": "var(--nyte-gray-0)",
  "--nyte-border-primary": "light-dark(var(--nyte-gray-30), var(--nyte-gray-120))",
  "--nyte-border-secondary": "light-dark(var(--nyte-gray-20), var(--nyte-gray-135))",
  "--nyte-border-strong": "light-dark(var(--nyte-gray-40), var(--nyte-gray-100))",
  "--nyte-border-interactive-primary": "var(--nyte-gray-80)",
  "--nyte-border-primary-translucent":
    "light-dark(var(--nyte-translucent-gray-30), var(--nyte-translucent-gray-120))",
  "--nyte-border-secondary-translucent":
    "light-dark(var(--nyte-translucent-gray-20), var(--nyte-translucent-gray-135))",
  "--nyte-border-strong-translucent":
    "light-dark(var(--nyte-translucent-gray-40), var(--nyte-translucent-gray-100))",
  "--nyte-border-control": "light-dark(var(--nyte-gray-40), var(--nyte-gray-100))",
  "--nyte-border-interactive-primary-translucent": "var(--nyte-translucent-gray-80)",
  "--nyte-border-control-translucent":
    "light-dark(var(--nyte-translucent-gray-40), var(--nyte-translucent-gray-100))",
  "--nyte-bg-base": "light-dark(var(--nyte-gray-0), var(--nyte-gray-145))",
  "--nyte-bg-muted": "light-dark(var(--nyte-gray-10), var(--nyte-gray-140))",
  "--nyte-bg-elevated": "light-dark(var(--nyte-gray-0), var(--nyte-gray-140))",
  "--nyte-bg-interactive-primary": "light-dark(var(--nyte-gray-30), var(--nyte-gray-120))",
  "--nyte-bg-interactive-primary-hover":
    "light-dark(oklch(from var(--nyte-bg-interactive-primary) calc(l * 0.95) c h), oklch(from var(--nyte-bg-interactive-primary) calc(l * 1.05) c h))",
  "--nyte-bg-interactive-primary-pressed":
    "light-dark(oklch(from var(--nyte-bg-interactive-primary) calc(l * 0.88) c h), oklch(from var(--nyte-bg-interactive-primary) calc(l * 1.12) c h))",
  "--nyte-bg-interactive-secondary": "light-dark(var(--nyte-gray-15), var(--nyte-gray-135))",
  "--nyte-bg-interactive-secondary-hover":
    "light-dark(oklch(from var(--nyte-bg-interactive-secondary) calc(l * 0.95) c h), oklch(from var(--nyte-bg-interactive-secondary) calc(l * 1.05) c h))",
  "--nyte-bg-interactive-secondary-pressed":
    "light-dark(oklch(from var(--nyte-bg-interactive-secondary) calc(l * 0.88) c h), oklch(from var(--nyte-bg-interactive-secondary) calc(l * 1.12) c h))",
  "--nyte-bg-interactive-strong": "light-dark(var(--nyte-gray-130), var(--nyte-gray-100))",
  "--nyte-bg-interactive-strong-hover":
    "light-dark(oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.2) c h), oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.05) c h))",
  "--nyte-bg-interactive-strong-pressed":
    "light-dark(oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.27) c h), oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.12) c h))",
  "--nyte-bg-inverse": "light-dark(var(--nyte-gray-130), var(--nyte-gray-120))",
  "--nyte-bg-control-selected": "light-dark(var(--nyte-gray-130), var(--nyte-gray-100))",
  "--nyte-bg-control-selected-hover":
    "light-dark(oklch(from var(--nyte-bg-control-selected) calc(l * 0.95) c h), oklch(from var(--nyte-bg-control-selected) calc(l * 1.05) c h))",
  "--nyte-bg-control-selected-pressed":
    "light-dark(oklch(from var(--nyte-bg-control-selected) calc(l * 0.88) c h), oklch(from var(--nyte-bg-control-selected) calc(l * 1.12) c h))",
  "--nyte-bg-control": "light-dark(var(--nyte-gray-40), var(--nyte-gray-100))",
  "--nyte-bg-control-hover":
    "light-dark(oklch(from var(--nyte-bg-control) calc(l * 0.95) c h), oklch(from var(--nyte-bg-control) calc(l * 1.05) c h))",
  "--nyte-bg-control-pressed":
    "light-dark(oklch(from var(--nyte-bg-control) calc(l * 0.88) c h), oklch(from var(--nyte-bg-control) calc(l * 1.12) c h))",
  "--nyte-bg-chrome": "light-dark(var(--nyte-gray-5), var(--nyte-gray-150))",
  "--nyte-bg-base-translucent":
    "light-dark(var(--nyte-translucent-gray-0), var(--nyte-translucent-gray-150))",
  "--nyte-bg-chrome-translucent":
    "light-dark(var(--nyte-translucent-gray-5), var(--nyte-translucent-gray-145))",
  "--nyte-bg-muted-translucent":
    "light-dark(var(--nyte-translucent-gray-10), var(--nyte-translucent-gray-140))",
  "--nyte-bg-interactive-primary-translucent":
    "light-dark(var(--nyte-translucent-gray-30), var(--nyte-translucent-gray-120))",
  "--nyte-bg-interactive-primary-translucent-hover":
    "oklch(from var(--nyte-bg-interactive-primary-translucent) l c h / calc(alpha + 0.055))",
  "--nyte-bg-interactive-primary-translucent-pressed":
    "oklch(from var(--nyte-bg-interactive-primary-translucent) l c h / calc(alpha + 0.1))",
  "--nyte-bg-interactive-secondary-translucent":
    "light-dark(var(--nyte-translucent-gray-15), var(--nyte-translucent-gray-135))",
  "--nyte-bg-interactive-secondary-translucent-hover":
    "oklch(from var(--nyte-bg-interactive-secondary-translucent) l c h / calc(alpha + 0.055))",
  "--nyte-bg-interactive-secondary-translucent-pressed":
    "oklch(from var(--nyte-bg-interactive-secondary-translucent) l c h / calc(alpha + 0.1))",
  "--nyte-bg-scrim-translucent":
    "light-dark(var(--nyte-translucent-gray-40), var(--nyte-translucent-gray-100))",
  "--nyte-bg-scrim": "light-dark(#00000026, #000000bf)",
  "--nyte-bg-hover": "var(--nyte-bg-interactive-secondary-translucent)",
  "--nyte-bg-pressed":
    "oklch(from var(--nyte-bg-interactive-secondary-translucent) l c h / calc(alpha + 0.045))",

  // Component colours built from the roles. They live in this group so a
  // scope that re-declares the roles re-resolves them on the same element.
  // Dark lets 64% of the window's vibrancy through the sidebar.
  "--nyte-sidebar-material":
    "light-dark(var(--nyte-bg-chrome), color-mix(in srgb, var(--nyte-bg-chrome) calc(36% + 64% * var(--nyte-reduce-transparency)), transparent))",
  // The floating material behind menus, popovers, the palette, and dialogs.
  "--nyte-popup-material":
    "light-dark(color-mix(in srgb, var(--nyte-bg-elevated) calc(80% + 20% * var(--nyte-reduce-transparency)), transparent), color-mix(in srgb, var(--nyte-bg-elevated) calc(90% + 10% * var(--nyte-reduce-transparency)), transparent))",
  // A control's hover and press, as layers over its own fill.
  "--nyte-layer-hover": "linear-gradient(var(--nyte-bg-hover), var(--nyte-bg-hover))",
  "--nyte-layer-pressed": "linear-gradient(var(--nyte-bg-pressed), var(--nyte-bg-pressed))",
  // Notion's interactive tertiary steps at half strength: the thumb stays as
  // light as Notion draws it, below the glyph role's 3:1 step.
  "--nyte-scrollbar-thumb":
    "color-mix(in srgb, light-dark(var(--nyte-gray-70), var(--nyte-gray-90)) 50%, transparent)",
  "--nyte-shadow-md-outline":
    "0px 8px 12px 0px #42230308, 0px 2px 6px 0px #42230308, 0 0 0 1px light-dark(var(--nyte-border-secondary-translucent), transparent), inset 0 0 0 1px light-dark(transparent, var(--nyte-border-secondary-translucent))",
  // A filled button's label needs 4.5:1, which the strong step does not give.
  "--nyte-button-fill": "var(--nyte-theme-100)",
  "--nyte-button-fill-hover":
    "light-dark(oklch(from var(--nyte-button-fill) calc(l * 0.95) c h), oklch(from var(--nyte-button-fill) calc(l * 1.05) c h))",
  "--nyte-button-fill-pressed":
    "light-dark(oklch(from var(--nyte-button-fill) calc(l * 0.88) c h), oklch(from var(--nyte-button-fill) calc(l * 1.12) c h))",
  "--nyte-conversation-user-shell-bg": "color-mix(in srgb, var(--nyte-bg-chrome) 60%, transparent)",
  "--nyte-conversation-user-bg": "var(--nyte-bg-elevated)",
  "--nyte-conversation-user-ring": "var(--nyte-border-secondary-translucent)",
  "--nyte-conversation-user-ring-active": "var(--nyte-border-primary-translucent)",
  "--nyte-conversation-technical-bg": "var(--nyte-bg-muted-translucent)",
  "--nyte-conversation-technical-ring": "var(--nyte-border-secondary-translucent)",
  "--nyte-conversation-guide": "var(--nyte-border-primary-translucent)",
  // Trays stack on the composer, so both take one fill.
  "--nyte-composer-bg": "var(--nyte-bg-elevated)",
  "--nyte-composer-ring": "var(--nyte-border-secondary-translucent)",
  "--nyte-composer-ring-active": "var(--nyte-border-primary-translucent)",
});
