# `@nyte-ai/ui`

React components for Nyte products and demos, compiled by default and available as source. Base UI and `@shadcn/react` own interaction and accessibility inside the package; StyleX styles the controls; each app owns layout and product composition.

## Add it to a demo

Install `@nyte-ai/ui` from the workspace and put its StyleX plugin before React. It wraps `@stylexjs/unplugin` and orders component rules below the app's, as the compiled build's `nyte-ui` layer does:

```ts
import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";

export default {
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  optimizeDeps: { exclude: ["@nyte-ai/ui"] },
  resolve: { dedupe: ["react", "react-dom"] },
};
```

The compiler emits the token declarations along with the component rules, so a StyleX app imports no stylesheet from the package.

## Compiled by default

Every component subpath resolves to the compiled build in `dist/`, so apps without a StyleX compiler import them as they are and load `@nyte-ai/ui/ui.css` once. That sheet declares the tokens on `:root` as well as the component rules. `pnpm --dir packages/ui build` writes `dist/`; `pnpm --dir packages/ui dev` rebuilds the JavaScript and CSS on change.

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

Every component has its own subpath, such as `@nyte-ai/ui/popover`. Import components from these individual paths. Each implementation lives directly in `src/<name>.tsx`, and its source export points to that file. Apps never import `@base-ui/react` directly; the lint config enforces it.

Style controls through `xstyle` with styles from `create()`, `className` with any class, or `style` with inline values. Each beats the component's own styles; set a property through `xstyle` or `className`, not both. Domain adapters stay in the app.

Chat layout parts in `message`, `bubble`, `marker`, `attachment`, `message-scroller` and `questionnaire` receive layout and paint through native `className` and `style`, with no `xstyle` or bundled shadcn Tailwind paint. Their buttons reuse existing Nyte control styles; custom `render` elements own their appearance. Base UI supplies polymorphic elements and button behavior, and `@shadcn/react` supplies scrolling and questionnaire state.

The `*.stylex` subpaths (`tokens`, `vars`, `schema`, `floating-surface`, `a11y`) always resolve to source, for apps that author StyleX against the same tokens.

## Theme it

Colour follows ramps → theme → roles. Both the default neutral mapping and the tinted mapping read the theme. Ramps and theme values are private. Use `role` for paint, `type` for text measurements, `motion` for timing, `shadow` for elevation, and `appearance` for cursor, material filter, and focus inputs.

```ts
import { role, type, motion, shadow, appearance } from "@nyte-ai/ui/vars.stylex";
import { button, input, row, menu, radius } from "@nyte-ai/ui/schema.stylex";
import { surfaceTheme, intent } from "@nyte-ai/ui/surface-theme";
```

Apply a hue and its roles together with `props(surfaceTheme.blue, styles.item)`. `surfaceTheme.gray` applies the tinted mapping over gray. The default uses the neutral mapping. `custom` follows `--nyte-custom-hue` and `--nyte-custom-chroma-scale`. Status text, syntax, dots, diff lines, and avatars use a hue or intent scope with an ordinary role. There are no fixed-hue handles. The focus ring alone stays blue.

Size values build component measurements, which build app layout. Consumers use component handles, not size values. `radius` names six rounding decisions: `square`, `indicator`, `control`, `card`, `surface`, and `pill`. Component-specific radii stay on their component handles.

Native apps read `platformColors.light` or `.dark` for neutral roles and `platformScopes.light.green` or `.dark.green` for scoped roles. These palettes contain concrete hex values and have no runtime dependencies. Native typography and touch geometry remain local.

Run `pnpm --dir packages/ui sync:tokens` after editing colour tokens. The generator reads the token AST and resolves CSS colours in each appearance and hue. `check:tokens` rejects stale output. `pnpm --dir packages/ui test` checks token dependencies, consumer access, and the committed schema lock. `typecheck:tokens` checks the foundation separately while consumers are being migrated.

## shadcn CLI configuration

`components.json` selects `base-nova`, TypeScript and client-rendered React. Its aliases target the flat `src/` directory; utilities use `cn` from `@nyte-ai/ui/style`. The configured CSS entry is `src/tailwind.css`, the existing bridge to Nyte tokens. Component paint remains in StyleX.

See the official [components.json reference](https://ui.shadcn.com/docs/components-json) for CLI settings.
