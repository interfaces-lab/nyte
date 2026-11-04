# @nyte-ai/ui

React components for Nyte products and demos. Base UI and `@shadcn/react` handle interaction and accessibility, StyleX styles the controls, and each app owns its layout and product composition. Components ship compiled, and apps that run StyleX can compile them from source.

## Quick start

Add `"@nyte-ai/ui": "workspace:*"` to the app's dependencies. In a Vite app that compiles StyleX, put the package's StyleX plugin before React and resolve the `nyte-source` condition:

```ts
import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: { exclude: ["@nyte-ai/ui"] },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
});
```

Add `"nyte-source"` to `customConditions` in `tsconfig.json` too, so TypeScript reads the same files. The condition has its own name so it never matches another package's generic `source` condition.

The plugin wraps `@stylexjs/unplugin` and orders component rules below the app's, as the compiled build's `nyte-ui` layer does. The compiler emits the token declarations along with the component rules, so the app needs no component stylesheet from the package. `@nyte-ai/ui/styles/base.css` is an optional reset and element baseline in the `base` layer.

Then import each component from its own subpath:

```tsx
import { Button } from "@nyte-ai/ui/button";
```

## Use the compiled build

Without the `nyte-source` condition, every component subpath resolves to the compiled build in `dist/`. An app without a StyleX compiler imports the components as they are and loads `@nyte-ai/ui/ui.css` once. That sheet declares the tokens on `:root` along with the component rules.

Every component rule sits in the `nyte-ui` layer. Declare that layer below the layers that should win:

```css
@layer theme, base, nyte-ui, stylex, components, utilities;
@import "tailwindcss";
@import "@nyte-ai/ui/ui.css";
@import "@nyte-ai/ui/styles/tailwind.css";
```

A Tailwind class passed through `className` then beats the component rule it targets. `@nyte-ai/ui/styles/tailwind.css` maps Tailwind's theme onto the tokens, so `bg-background`, `text-muted-foreground`, `border-border` and `rounded-md` paint with the same values as the components. Put the app's own StyleX layers above `nyte-ui` too.

## What it exports

Every component has its own subpath, such as `@nyte-ai/ui/popover`. Import components from these paths. Apps never import `@base-ui/react` directly, and the lint config enforces it.

Style a control through `xstyle` with styles from `create()`, `className` with any class, or `style` with inline values. Each one beats the component's own styles. Set a property through `xstyle` or `className`, not both. Domain adapters stay in the app.

The chat parts `message`, `bubble`, `marker` and `attachment` take layout and paint through `className` and `style`, with no `xstyle`. Their buttons reuse Nyte's control styles, and custom `render` elements own their appearance. Base UI supplies polymorphic elements and button behavior. `@shadcn/react` supplies scrolling in `message-scroller` and state in `questionnaire`.

The `@nyte-ai/ui/styles/*.stylex` subpaths always resolve to source, for apps that write StyleX against the same tokens. They are `tokens`, `vars`, `schema`, `text`, `floating-surface` and `a11y`.

## Theme it

Colour flows from ramps to the theme to roles. Ramps and theme values are private. Use `role` for paint, `type` for text measurements, `motion` for timing, `shadow` for elevation, and `appearance` for cursor, material filter and focus inputs.

```ts
import { role, type, motion, shadow, appearance } from "@nyte-ai/ui/styles/vars.stylex";
import { button, input, row, menu, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme, intent } from "@nyte-ai/ui/surface-theme";
```

The default theme uses the neutral mapping. Apply a hue and its roles together with `props(surfaceTheme.blue, styles.item)`, which switches to the tinted mapping. `surfaceTheme.gray` applies the tinted mapping over gray. `surfaceTheme.custom` follows `--nyte-custom-hue` and `--nyte-custom-chroma-scale`. Status text, syntax, dots, diff lines and avatars use a hue or `intent` scope with an ordinary role. There are no fixed-hue handles. Only the focus ring stays blue.

Size values build component measurements, and those build app layout. Consumers use component handles, not size values. `radius` names five rounding decisions: `indicator`, `control`, `card`, `surface` and `pill`. Component-specific radii stay on their component handles.

Native apps import `platformColors` and `platformScopes` from `@nyte-ai/ui/platform-colors`. Read `platformColors.light` or `.dark` for neutral roles and `platformScopes.light.green` or `.dark.green` for scoped roles. These palettes hold concrete hex values and have no runtime dependencies. Native typography and touch geometry stay in the native app.

## shadcn CLI

`components.json` selects the `base-nova` style, TypeScript and client-rendered React. Its aliases point at `@nyte-ai/ui`, and utilities use `cn` from `@nyte-ai/ui/style`. The configured CSS entry is `src/styles/tailwind.css`, the bridge to Nyte tokens. Component paint stays in StyleX. See the [components.json reference](https://ui.shadcn.com/docs/components-json) for the CLI settings.

## Development

```sh
pnpm --dir packages/ui build
pnpm --dir packages/ui dev
pnpm --dir packages/ui typecheck
```

`build` writes `dist/`, and `dev` rebuilds the JavaScript and CSS on change. `typecheck` also runs `check:tokens` and `check:stylex`.

After you edit tokens, regenerate the native palettes and the design-scale lint tables:

```sh
pnpm --dir packages/ui sync:tokens
```

The palette generator reads the token source and resolves CSS colours in each appearance and hue. `check:tokens` rejects stale output and checks the committed schema lock in `test/token-lock.json`. Run `pnpm --dir packages/ui lock:tokens` to update that lock.

Read [AGENTS.md](AGENTS.md) before changing the package.
