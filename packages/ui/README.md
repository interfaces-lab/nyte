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

Components paint with inherited `--nyte-*` custom properties declared on `:root` by `tokens.stylex.ts`. Every colour is a `light-dark()` pair, so appearance follows `color-scheme` rather than a class.

Anchors such as `--nyte-ink`, `--nyte-page-base`, and `--nyte-accent-base` feed the steps mixed from them. A step resolves its `var()` where it is declared, so an anchor override moves the steps only on `:root`. Below the root, override the step itself:

```css
:root {
  --nyte-accent-base: #7c3aed;
}

.my-demo {
  color-scheme: dark;
  --nyte-bg-page: #101014;
}
```

Apps that author StyleX read the tokens through the typed constants in `vars.stylex.ts`:

```ts
import { t } from "@nyte-ai/ui/vars.stylex";
```

Native apps import `platformColors` from `@nyte-ai/ui/platform-colors`. Its `light` and `dark` palettes hold every colour token as a concrete hex value, named in camelCase without the `--nyte-` prefix, such as `platformColors.dark.textPrimary`. This entrypoint has no runtime dependencies. Apps map those colours to their own native theme and keep platform typography and touch geometry locally.

After editing the palette in `tokens.stylex.ts`, run `pnpm --dir packages/ui sync:tokens` to regenerate `platform-colors.ts`; `check:tokens` fails when it is stale. The generator imports the module with `defineVars` and `defineConsts` stubbed to the identity function, so it reads the declared values rather than parsing them. It takes each token's `rgb()` fallback, resolves it in both appearances by following `var()` and evaluating `light-dark()` and `color-mix()` the way CSS does, with the workspace tint at its default, and rejects any colour token that does not reduce to a concrete value, because React Native can evaluate none of them.
