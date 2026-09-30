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

A Tailwind class passed through `className` then beats the component rule it targets. `@nyte-ai/ui/tailwind.css` maps Tailwind's theme onto the tokens, so `bg-background`, `text-muted-foreground`, `border-border`, and `rounded-md` paint with the same values as the components. `stylex.create` in the app can read `@nyte-ai/ui/vars.stylex`, which always resolves to source. Put the app's StyleX layers above `nyte-ui` as well.

Apps that compile StyleX themselves resolve `src/` instead through the `nyte-source` export condition (named so it never matches another package's generic `source` condition): add `"nyte-source"` ahead of the defaults in Vite's `resolve.conditions` and to `customConditions` in `tsconfig.json`.

## What it exports

Every component is styled. The root exports all of them, and each component subpath, such as `@nyte-ai/ui/popover`, exports the same styled component on its own. Apps never import `@base-ui/react` or `sonner` directly; the lint config enforces it.

Extend a component through `xstyle` for a StyleX override, `className` for a class such as a Tailwind utility, or `style` for inline values. All three merge after the component's own styles. There is no unstyled mode, and domain adapters stay in the app.

The `*.stylex` subpaths (`tokens`, `vars`, `schema`, `floating-surface`, `a11y`) always resolve to source, for apps that author StyleX against the same tokens.

An app that paints something above the DOM, such as an Electron browser view, wraps its tree in `OverlayRefProvider` from `@nyte-ai/ui/overlay`. Every popup, scrim, and toast list attaches the ref callback it passes, so the app knows what is open and where.

## Theme it

Components paint with inherited `--nyte-*` custom properties declared on `:root` by `tokens.stylex.ts`, in Notion Calendar's layers: `lab()` ramps (`ramps.stylex.ts`), a theme layer that picks one hue (`theme.stylex.ts`), and the roles every surface paints with (`roles.stylex.ts`). Every role is a `light-dark()` pair, so appearance follows `color-scheme` rather than a class.

A scope paints a subtree in one hue. `@nyte-ai/ui/surface-theme` exports `surfaceTheme` (one entry per hue, plus `custom` for a hue built from `--nyte-custom-hue` and `--nyte-custom-chroma-scale`) and `intent` (`primary`, `success`, `warning`, `danger`). Each bundles the hue's theme with the roles re-declared from it; pass it to `stylex.props` on the element that starts the scope. Popups take a `tint` prop for the same thing, and `toastTint()` scopes one toast.

A scope re-declares every role on its element, so a role overridden on `:root` holds only outside scopes. Override on the element itself, or give the subtree a scope:

```css
.my-demo {
  color-scheme: dark;
  --nyte-bg-base: #101014;
}
```

Apps that author StyleX read the tokens through the typed constants in `vars.stylex.ts`: `t` for roles and component tokens, `ramp` for a hue step that must not follow a scope.

```ts
import { ramp, t } from "@nyte-ai/ui/vars.stylex";
```

Native apps import `platformColors` from `@nyte-ai/ui/platform-colors`. Its `light` and `dark` palettes hold every role and component colour as a concrete hex value, named in camelCase without the `--nyte-` prefix, such as `platformColors.dark.contentPrimary`. This entrypoint has no runtime dependencies. Apps map those colours to their own native theme and keep platform typography and touch geometry locally.

After editing the colour tokens, run `pnpm --dir packages/ui sync:tokens` to regenerate `platform-colors.ts`; `check:tokens` fails when it is stale. The generator imports the token modules with `defineVars` and `defineConsts` stubbed to the identity function, so it reads the declared values rather than parsing them. It resolves the roles and the unscoped colours in both appearances, following `var()`, `light-dark()`, `lab()`, `color-mix(in srgb, …)`, and relative `oklch(from …)` the way CSS does, outside any scope and with reduced transparency off, and rejects any colour that does not reduce to a concrete value, because React Native can evaluate none of them. A colour token that mixes in any space other than sRGB fails the run.
