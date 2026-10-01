# `@nyte-ai/ui`

Styled React components for Nyte products and demos, compiled by default and available as source. Base UI owns interaction and accessibility inside the package; StyleX owns the look; each app owns layout and product composition.

## Add it to a demo

Install `@nyte-ai/ui` from the workspace and put the StyleX compiler before React:

```ts
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";

export default {
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: { exclude: ["@nyte-ai/ui"] },
  resolve: { dedupe: ["react", "react-dom"] },
};
```

The compiler emits the token declarations along with the component rules, so a StyleX app imports no stylesheet from the package.

## Compiled by default

`@nyte-ai/ui` and every component subpath resolve to the compiled build in `dist/`, so apps without a StyleX compiler import them as they are and load `@nyte-ai/ui/ui.css` once. That sheet declares the tokens on `:root` as well as the component rules. `pnpm --dir packages/ui build` writes `dist/`; `pnpm --dir packages/ui dev` rebuilds the JavaScript and CSS on change.

Every component rule sits in the `nyte-ui` layer. Declare it below the layers that should win:

```css
@layer theme, base, nyte-ui, stylex, components, utilities;
@import "tailwindcss";
@import "@nyte-ai/ui/ui.css";
@import "@nyte-ai/ui/tailwind.css";
```

A Tailwind class passed through `className` then beats the component rule it targets. `@nyte-ai/ui/tailwind.css` maps Tailwind's theme onto the tokens, so `bg-background`, `text-muted-foreground`, `border-border`, and `rounded-md` paint with the same values as the components. `create` in the app can read `@nyte-ai/ui/vars.stylex`, which always resolves to source. Put the app's StyleX layers above `nyte-ui` as well.

Apps that compile StyleX themselves resolve `src/` instead through the `nyte-source` export condition (named so it never matches another package's generic `source` condition): add `"nyte-source"` ahead of the defaults in Vite's `resolve.conditions` and to `customConditions` in `tsconfig.json`.

## What it exports

Every component is styled. The root exports all of them, and each component subpath, such as `@nyte-ai/ui/popover`, exports the same styled component on its own. Apps never import `@base-ui/react` or `sonner` directly; the lint config enforces it.

Extend a component through `xstyle` for a StyleX override, `className` for a class such as a Tailwind utility, or `style` for inline values. All three merge after the component's own styles. There is no unstyled mode, and domain adapters stay in the app.

The `*.stylex` subpaths (`tokens`, `vars`, `schema`, `floating-surface`, `a11y`) always resolve to source, for apps that author StyleX against the same tokens.

An app that paints something above the DOM, such as an Electron browser view, wraps its tree in `OverlayRefProvider` from `@nyte-ai/ui/overlay`. Every popup, scrim, and toast list attaches the ref callback it passes, so the app knows what is open and where.

## Theme it

Colour follows ramps → theme → roles. Both the default neutral mapping and the tinted mapping read the theme. Ramps and theme values are private. Use `role` for paint, `type` for text measurements, `motion` for timing, `shadow` for elevation, and `appearance` for cursor, material filter, and focus inputs.

```ts
import { role, type, motion, shadow, appearance } from "@nyte-ai/ui/vars.stylex";
import { button, input, row, menu, shape } from "@nyte-ai/ui/schema.stylex";
import { surfaceTheme, intent } from "@nyte-ai/ui/surface-theme";
```

Apply a hue and its roles together with `props(surfaceTheme.blue, styles.item)`. `surfaceTheme.gray` applies the tinted mapping over gray. The default uses the neutral mapping. `custom` follows `--nyte-custom-hue` and `--nyte-custom-chroma-scale`. Status text, syntax, dots, diff lines, and avatars use a hue or intent scope with an ordinary role. There are no fixed-hue handles. The focus ring alone stays blue.

Size values build component measurements, which build app layout. Consumers use component handles, not size values. `shape` names six rounding decisions: `square`, `indicator`, `control`, `card`, `surface`, and `pill`. Component-specific radii stay on their component handles.

Native apps read `platformColors.light` or `.dark` for neutral roles and `platformScopes.light.green` or `.dark.green` for scoped roles. These palettes contain concrete hex values and have no runtime dependencies. Native typography and touch geometry remain local.

Run `pnpm --dir packages/ui sync:tokens` after editing colour tokens. The generator reads the token AST and resolves CSS colours in each appearance and hue. `check:tokens` rejects stale output. `pnpm --dir packages/ui test` checks token dependencies, consumer access, and the committed schema lock. `typecheck:tokens` checks the foundation separately while consumers are being migrated.
