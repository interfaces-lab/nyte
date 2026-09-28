/**
 * The design tokens: every value a Nyte surface paints with, keyed by the
 * custom property it compiles to. Plain CSS, the desktop terminal, and the
 * desktop startup shell read a token by that name; StyleX code takes the typed
 * handles in `vars.stylex.ts` and `schema.stylex.ts`.
 *
 * Colours are oklch, with the same colour in `rgb()` for engines without
 * oklch. Both appearances share one declaration through `light-dark()`, which
 * follows the host's `color-scheme`; the desktop sets it from `data-theme` in
 * its `appearance.css`. What `light-dark()` cannot carry (a filter, the
 * workspace tint, reduced transparency) is overridden there, keyed on the
 * attributes the desktop's `boot.ts` writes.
 *
 * The values are the lab's token decisions
 * (`packages/lab/src/token-choice/decisions.ts`): Notion Calendar's surfaces,
 * icons, fills, and strokes over the desktop's own ink ramp, hues, status
 * text, and type.
 */
import * as stylex from "@stylexjs/stylex";

const oklch = "@supports (color: oklch(0 0 0))";

/** An oklch value, falling back to the same colour in `rgb()`. */
const color = (value: string, fallback: string) => ({ default: fallback, [oklch]: value });

export const palette = stylex.defineVars({
  // Anchors. The workspace tint re-hues the page, the sidebar, and the accent
  // from these, so each keeps an untinted `-base`.
  "--nyte-ink": color(
    "light-dark(oklch(0.3098 0.0076 84.59), oklch(1 0 0 / 0.81))",
    "light-dark(rgb(50 48 44), rgb(255 255 255 / 0.81))",
  ),
  "--nyte-page-base": color(
    "light-dark(oklch(1 0 0), oklch(0.2134 0 0))",
    "light-dark(rgb(255 255 255), rgb(25 25 25))",
  ),
  "--nyte-sidebar-base": color(
    "light-dark(oklch(0.9789 0.0013 106.42), oklch(0.2435 0 0))",
    "light-dark(rgb(248 248 247), rgb(32 32 32))",
  ),
  "--nyte-accent-base": color("oklch(0.6068 0.1404 251.76)", "rgb(57 133 211)"),
  "--nyte-red": color("oklch(0.6424 0.2433 23.68)", "rgb(255 38 60)"),
  "--nyte-green": color("oklch(0.7339 0.1832 154.49)", "rgb(0 201 114)"),
  "--nyte-yellow": color("oklch(0.7703 0.1741 64.05)", "rgb(255 152 0)"),
  "--nyte-orange": color("oklch(0.6971 0.2035 43.8)", "rgb(255 103 0)"),
  "--nyte-purple": color("oklch(0.6131 0.2321 294.07)", "rgb(145 89 254)"),
  "--nyte-cyan": color("oklch(0.7127 0.1289 180.44)", "rgb(0 188 166)"),
  "--nyte-magenta": color("oklch(0.6691 0.2492 355.57)", "rgb(255 48 155)"),
  "--nyte-tint-hue": "210deg",
  "--nyte-tint-intensity": "0%",
  "--nyte-tint-swatch": color(
    "oklch(from hsl(var(--nyte-tint-hue) var(--nyte-tint-intensity) 50%) l c h)",
    "hsl(var(--nyte-tint-hue) var(--nyte-tint-intensity) 50%)",
  ),
  "--nyte-accent": "var(--nyte-accent-base)",
  "--nyte-sidebar": "var(--nyte-sidebar-base)",

  // Surfaces. The window, the main pane, and editors share one page.
  "--nyte-bg-page": "var(--nyte-page-base)",
  // Dark lets 64% of the window's vibrancy through the sidebar.
  "--nyte-bg-sidebar":
    "light-dark(var(--nyte-sidebar), color-mix(in srgb, var(--nyte-sidebar) 36%, transparent))",
  "--nyte-bg-raised": color(
    "light-dark(oklch(1 0 0), oklch(0.2645 0 0))",
    "light-dark(rgb(255 255 255), rgb(37 37 37))",
  ),
  "--nyte-bg-scrim": color(
    "light-dark(oklch(0.2226 0.0099 88.8 / 0.28), oklch(0 0 0 / 0.5))",
    "light-dark(rgb(29 27 22 / 0.28), rgb(0 0 0 / 0.5))",
  ),
  // The floating material behind menus, popovers, the palette, and dialogs.
  "--nyte-material-bg": color(
    "light-dark(oklch(1 0 0 / 0.8), oklch(0.2435 0 0 / 0.9))",
    "light-dark(rgb(255 255 255 / 0.8), rgb(32 32 32 / 0.9))",
  ),
  "--nyte-material-filter": "blur(12px)",

  // Text. Secondary and tertiary stay translucent steps of the ink.
  "--nyte-text-primary": "var(--nyte-ink)",
  "--nyte-text-secondary": "color-mix(in srgb, var(--nyte-ink) 74%, transparent)",
  "--nyte-text-tertiary": "color-mix(in srgb, var(--nyte-ink) 60%, transparent)",
  "--nyte-text-quaternary": color(
    "light-dark(oklch(0.4094 0.0235 79.91 / 0.32), oklch(1 0 0 / 0.13))",
    "light-dark(rgb(81 73 60 / 0.32), rgb(255 255 255 / 0.13))",
  ),
  "--nyte-text-shimmer": "color-mix(in srgb, var(--nyte-ink) 40%, transparent)",
  // Over the inverse fill, which inverts against the page.
  "--nyte-text-on-inverse": "var(--nyte-bg-page)",
  // Over a saturated fill, where the ink ramp does not apply.
  "--nyte-text-on-color": color(
    "light-dark(oklch(0.9911 0 0), oklch(1 0 0))",
    "light-dark(rgb(252 252 252), rgb(255 255 255))",
  ),
  "--nyte-text-accent": color("oklch(0.6058 0.1674 252.7)", "rgb(35 131 226)"),
  "--nyte-text-cyan": color(
    "light-dark(oklch(0.5365 0.0938 183.29), oklch(0.8025 0.1224 183.11))",
    "light-dark(rgb(8 127 115), rgb(75 216 198))",
  ),
  "--nyte-text-success": color(
    "light-dark(oklch(0.5273 0.1282 155.89), oklch(0.7769 0.1615 159.51))",
    "light-dark(rgb(0 128 74), rgb(56 213 145))",
  ),
  "--nyte-text-warning": color("oklch(0.697 0.1296 76.04)", "rgb(203 145 47)"),
  "--nyte-text-danger": color(
    "light-dark(oklch(0.5248 0.1964 23.19), oklch(0.6863 0.204 18.66))",
    "light-dark(rgb(194 29 46), rgb(255 86 103))",
  ),

  // Icons.
  "--nyte-icon-primary": "var(--nyte-ink)",
  "--nyte-icon-secondary": color(
    "light-dark(oklch(0.3945 0.0036 84.57 / 0.6), oklch(1 0 0 / 0.445))",
    "light-dark(rgb(71 70 68 / 0.6), rgb(255 255 255 / 0.445))",
  ),
  "--nyte-icon-tertiary": color(
    "light-dark(oklch(0.4094 0.0235 79.91 / 0.32), oklch(1 0 0 / 0.283))",
    "light-dark(rgb(81 73 60 / 0.32), rgb(255 255 255 / 0.283))",
  ),

  // Fills. Hover, selected, and pressed are states laid over whatever sits
  // beneath; quiet and strong are resting fills.
  "--nyte-fill-hover": color(
    "light-dark(oklch(0 0 0 / 0.04), oklch(1 0 0 / 0.05))",
    "light-dark(rgb(0 0 0 / 0.04), rgb(255 255 255 / 0.05))",
  ),
  "--nyte-fill-selected": color(
    "light-dark(oklch(0 0 0 / 0.06), oklch(1 0 0 / 0.065))",
    "light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.065))",
  ),
  "--nyte-fill-pressed": color(
    "light-dark(oklch(0 0 0 / 0.08), oklch(1 0 0 / 0.08))",
    "light-dark(rgb(0 0 0 / 0.08), rgb(255 255 255 / 0.08))",
  ),
  "--nyte-fill-quiet": color(
    "light-dark(oklch(0.4075 0.0392 83.28 / 0.04), oklch(0.1957 0 0))",
    "light-dark(rgb(84 72 49 / 0.04), rgb(21 21 21))",
  ),
  "--nyte-fill-strong": color(
    "light-dark(oklch(0.4075 0.0392 83.28 / 0.15), oklch(0.2435 0 0))",
    "light-dark(rgb(84 72 49 / 0.15), rgb(32 32 32))",
  ),
  "--nyte-fill-inverse": "var(--nyte-ink)",
  "--nyte-fill-accent-subtle": "color-mix(in srgb, var(--nyte-accent) 12%, transparent)",
  "--nyte-fill-success-subtle": "color-mix(in srgb, var(--nyte-green) 12%, transparent)",
  "--nyte-fill-warning-subtle": "color-mix(in srgb, var(--nyte-yellow) 12%, transparent)",
  "--nyte-fill-danger-subtle": "color-mix(in srgb, var(--nyte-red) 12%, transparent)",
  // A button's hover and press, as layers over its own fill.
  "--nyte-layer-hover": "linear-gradient(var(--nyte-fill-hover), var(--nyte-fill-hover))",
  "--nyte-layer-pressed": "linear-gradient(var(--nyte-fill-pressed), var(--nyte-fill-pressed))",
  // Notion publishes the light gradient only; dark runs from the raised
  // surface down to the sidebar's tone.
  "--nyte-button-secondary-bg": color(
    "linear-gradient(light-dark(oklch(0.9911 0 0), oklch(0.2645 0 0)), light-dark(oklch(0.9761 0 0), oklch(0.2435 0 0)))",
    "linear-gradient(light-dark(rgb(252 252 252), rgb(37 37 37)), light-dark(rgb(247 247 247), rgb(32 32 32)))",
  ),
  "--nyte-switch-thumb": color("oklch(1 0 0)", "rgb(255 255 255)"),

  // Strokes.
  "--nyte-stroke-primary": color(
    "light-dark(oklch(0.4075 0.0392 83.28 / 0.15), oklch(1 0 0 / 0.13))",
    "light-dark(rgb(84 72 49 / 0.15), rgb(255 255 255 / 0.13))",
  ),
  "--nyte-stroke-secondary": color(
    "light-dark(oklch(0.4075 0.0392 83.28 / 0.08), oklch(1 0 0 / 0.055))",
    "light-dark(rgb(84 72 49 / 0.08), rgb(255 255 255 / 0.055))",
  ),
  "--nyte-stroke-tertiary": color(
    "light-dark(oklch(0.4075 0.0392 83.28 / 0.04), oklch(0.1957 0 0))",
    "light-dark(rgb(84 72 49 / 0.04), rgb(21 21 21))",
  ),
  "--nyte-stroke-focused": "var(--nyte-accent)",
  // `appearance.css` clears this while focus arrives by pointer.
  "--nyte-focus-ring": "var(--nyte-stroke-focused)",
  // `appearance.css` sets this to `default` unless the user opts into pointer cursors.
  "--nyte-cursor-interactive": "pointer",
  "--nyte-image-outline": color(
    "light-dark(oklch(0 0 0 / 0.1), oklch(1 0 0 / 0.1))",
    "light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.1))",
  ),
  "--nyte-scrollbar-thumb": "color-mix(in srgb, var(--nyte-ink) 14%, transparent)",
  // Selected text, in the page and in the terminal.
  "--nyte-selection": "color-mix(in srgb, var(--nyte-accent) 30%, transparent)",

  // Diffs, from Notion's green and red ramps. Dark takes the 50 and 200
  // washes, since its 30 and 100 steps are opaque tints.
  "--nyte-diff-added-line-bg": color(
    "light-dark(oklch(0.724 0.0995 146.91 / 0.07), oklch(0.6088 0.1264 157.38 / 0.08))",
    "light-dark(rgb(123 183 129 / 0.07), rgb(45 153 100 / 0.08))",
  ),
  "--nyte-diff-added-text-bg": color(
    "light-dark(oklch(0.724 0.0995 146.91 / 0.27), oklch(0.6088 0.1264 157.38 / 0.2))",
    "light-dark(rgb(123 183 129 / 0.27), rgb(45 153 100 / 0.2))",
  ),
  "--nyte-diff-removed-line-bg": color(
    "light-dark(oklch(0.7389 0.1341 30.62 / 0.07), oklch(0.631 0.1716 22.17 / 0.1))",
    "light-dark(rgb(243 136 118 / 0.07), rgb(222 85 88 / 0.1))",
  ),
  "--nyte-diff-removed-text-bg": color(
    "light-dark(oklch(0.8078 0.0884 29.52 / 0.4), oklch(0.6305 0.1719 23.41 / 0.25))",
    "light-dark(rgb(244 171 159 / 0.4), rgb(222 85 85 / 0.25))",
  ),

  // Conversation.
  "--nyte-conversation-user-shell-bg": "color-mix(in srgb, var(--nyte-sidebar) 60%, transparent)",
  "--nyte-conversation-user-bg": "var(--nyte-bg-raised)",
  "--nyte-conversation-user-ring": "var(--nyte-stroke-secondary)",
  "--nyte-conversation-user-ring-active": "var(--nyte-stroke-primary)",
  "--nyte-conversation-technical-bg": color(
    "light-dark(oklch(0.1913 0 0 / 0.0196), oklch(0.9551 0 0 / 0.0275))",
    "light-dark(rgb(20 20 20 / 0.0196), rgb(240 240 240 / 0.0275))",
  ),
  "--nyte-conversation-technical-ring": color(
    "light-dark(oklch(0.1913 0 0 / 0.0784), oklch(0.9551 0 0 / 0.1098))",
    "light-dark(rgb(20 20 20 / 0.0784), rgb(240 240 240 / 0.1098))",
  ),
  "--nyte-conversation-guide": color(
    "light-dark(oklch(0.1913 0 0 / 0.1216), oklch(0.9551 0 0 / 0.149))",
    "light-dark(rgb(20 20 20 / 0.1216), rgb(240 240 240 / 0.149))",
  ),
  // Trays stack on the composer, so both take one fill.
  "--nyte-composer-bg": "var(--nyte-bg-raised)",
  "--nyte-composer-ring": "var(--nyte-stroke-secondary)",
  "--nyte-composer-ring-active": "var(--nyte-stroke-primary)",
});

export const elevation = stylex.defineVars({
  "--nyte-shadow-color": color("oklch(0 0 0 / 0.2)", "rgb(0 0 0 / 0.2)"),
  "--nyte-shadow-control-color": "color-mix(in srgb, var(--nyte-shadow-color) 60%, transparent)",
  "--nyte-shadow-button": color(
    "0 2px 4px light-dark(oklch(0 0 0 / 0.04), oklch(0 0 0 / 0.08))",
    "0 2px 4px light-dark(rgb(0 0 0 / 0.04), rgb(0 0 0 / 0.08))",
  ),
  "--nyte-shadow-popover": color(
    "0 4px 12px -2px light-dark(oklch(0 0 0 / 0.08), oklch(0 0 0 / 0.16))",
    "0 4px 12px -2px light-dark(rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.16))",
  ),
  "--nyte-shadow-modal": color(
    "0 24px 48px -8px light-dark(oklch(0 0 0 / 0.24), oklch(0 0 0 / 0.48)), 0 4px 12px -1px light-dark(oklch(0 0 0 / 0.12), oklch(0 0 0 / 0.24))",
    "0 24px 48px -8px light-dark(rgb(0 0 0 / 0.24), rgb(0 0 0 / 0.48)), 0 4px 12px -1px light-dark(rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.24))",
  ),
  "--nyte-shadow-workbench":
    "0 0 8px 2px color-mix(in srgb, var(--nyte-shadow-color) 40%, transparent)",
  "--nyte-tray-shadow": "0 0 8px 2px color-mix(in srgb, var(--nyte-shadow-color) 30%, transparent)",
  "--nyte-conversation-user-shadow": color(
    "0 1px 2px oklch(0 0 0 / 0.05)",
    "0 1px 2px rgb(0 0 0 / 0.05)",
  ),
});

/**
 * The desktop's `boot.ts` writes the family and size inputs inline on <html>
 * before first paint; the scale derives from them here. Inter and JetBrains
 * Mono ship with the app, `system-ui` and `ui-monospace` are whatever the OS
 * has.
 */
export const typography = stylex.defineVars({
  "--nyte-ui-font-inter": '"Inter Variable", system-ui, sans-serif',
  "--nyte-ui-font-system": "system-ui, sans-serif",
  "--nyte-code-font-jetbrains-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
  "--nyte-code-font-system":
    'ui-monospace, Menlo, "DejaVu Sans Mono", "Liberation Mono", Consolas, monospace',
  "--nyte-font-family-sans": "var(--nyte-ui-font-inter)",
  "--nyte-font-family-mono": "var(--nyte-code-font-system)",
  "--nyte-font-size-base": "13px",
  "--nyte-font-size-code": "12px",
  "--nyte-font-size-xs": "max(11px, calc(var(--nyte-font-size-base) - 2px))",
  "--nyte-font-size-sm": "calc(var(--nyte-font-size-base) - 1px)",
  // Chat, composer, and bubbles set 15px type on 13px chrome.
  "--nyte-font-size-lg": "calc(var(--nyte-font-size-base) + 2px)",
  "--nyte-font-size-2xl": "calc(var(--nyte-font-size-base) + 6px)",
  "--nyte-line-height-xs": "calc(var(--nyte-font-size-base) + 1px)",
  "--nyte-line-height-sm": "calc(var(--nyte-font-size-base) + 3px)",
  "--nyte-line-height-base": "calc(var(--nyte-font-size-base) + 5px)",
  "--nyte-line-height-lg": "calc(var(--nyte-font-size-base) + 11px)",
  "--nyte-letter-spacing-base": "0px",
  "--nyte-letter-spacing-lg": "-0.24px",
});

export const radius = stylex.defineVars({
  "--nyte-radius-xs": "2px",
  "--nyte-radius-sm": "4px",
  "--nyte-radius-base": "6px",
  "--nyte-radius-lg": "8px",
  "--nyte-radius-xl": "12px",
  "--nyte-radius-2xl": "14px",
  "--nyte-radius-full": "9999px",
});

export const motion = stylex.defineVars({
  "--nyte-duration-instant": "50ms",
  "--nyte-duration-fast": "100ms",
  "--nyte-duration-normal": "150ms",
  "--nyte-duration-slow": "200ms",
  "--nyte-easing-out": "ease-out",
  "--nyte-easing-out-quint": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--nyte-easing-in-out-strong": "cubic-bezier(0.77, 0, 0.175, 1)",
});

/** The component measurements `schema.stylex.ts` names; each is documented at its handle. */
export const geometry = stylex.defineVars({
  "--nyte-glyph-box": "15px",
  "--nyte-menu-item-height": "26px",
  "--nyte-menu-padding": "4px",
  "--nyte-menu-radius": "10px",
  "--nyte-menu-item-radius": "var(--nyte-radius-base)",
  "--nyte-menu-item-gap": "6px",
  "--nyte-menu-item-padding-inline": "6px",
  "--nyte-menu-item-padding-block": "5px",
  "--nyte-menu-width": "200px",
  "--nyte-model-menu-width": "230px",
  "--nyte-parameter-menu-width": "220px",
  "--nyte-menu-max-height": "min(320px, calc(100vh - 32px))",
  "--nyte-dialog-width": "400px",
  "--nyte-dialog-padding": "24px",
  "--nyte-dialog-gap": "16px",
  "--nyte-dialog-radius": "var(--nyte-radius-xl)",
  "--nyte-toast-close-gutter": "44px",
  "--nyte-clipboard-preview-max-width": "360px",
  "--nyte-clipboard-preview-max-height": "240px",
});
