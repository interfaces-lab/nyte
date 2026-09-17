# `@nyte-ai/ui`

Raw-source React primitives for Nyte products and demos. Base UI owns interaction and accessibility; StyleX owns reusable component styling; each app owns layout, typography, and product identity.

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

Import `@nyte-ai/ui/platform-tokens.css` once for StyleX-only apps. Apps that also author Tailwind can import `@nyte-ai/ui/styles.css` instead; it includes the same tokens and maps them into Tailwind's theme.

Product-specific composites import each headless namespace from its direct component subpath, such as `@nyte-ai/ui/popover`. This keeps the Base UI dependency and version behind the shared package while the product retains its own composition and geometry. Simple controls should use the styled root exports. Their `unstyled` mode is reserved for product surfaces that supply a complete `xstyle` treatment.

## Theme it

Primitives use inherited `--nyte-*` custom properties. Override only the tokens that express the app's identity, ideally on the app root so previews can be themed independently:

```css
.my-demo {
  color-scheme: dark;
  --nyte-color-avatar-orange-background: #5f2a06;
  --nyte-color-avatar-orange-foreground: #ffb27d;
}
```

The generated CSS variables and the typed StyleX map come from `platform-tokens.stylex.ts`. Apps that author StyleX import the groups from that file:

```ts
import { colorVars } from "@nyte-ai/ui/platform-tokens.stylex";
```

StyleX only keeps `--nyte-*` names through a direct `defineVars` import. Do not read `tokens.color` inside `stylex.create`. Use `className` for layout, including Tailwind, and `xstyle` when you need a StyleX override. Reuse Base UI parts before creating a new wrapper, and keep domain adapters in the app.

Native apps import `platformColors` from `@nyte-ai/ui/platform-colors`. Its `light` and `dark` palettes contain raw colors with camelCase names, such as `platformColors.dark.foreground`. This entrypoint has no runtime dependencies. Apps map those colors to their own native theme and keep platform typography and touch geometry locally. The CSS-only `focus-ring` alias is omitted; native controls can use `ring` directly.

Those raw colors are not a second set of values. `platform-tokens.stylex.ts` declares the palette in two layers. Anchors carry literals per appearance: the surfaces (`base`, `editor`, `chrome`, `sidebar`, `raised`), the fills, and the named hues. Everything else derives from an anchor at a fixed ratio, so a surface change or a hue swap moves every step that depends on it instead of drifting. A literal belongs in an anchor; anything a component names is derived.

After editing `platform-tokens.stylex.ts`, run `pnpm --dir packages/ui sync:tokens` to regenerate both `platform-tokens.css` and `platform-colors.ts`. The generator imports the module with `defineVars` and `defineConsts` stubbed to the identity function, so it reads the declared values rather than parsing them. It then resolves every token in both appearances, following `var()` into other declared tokens and evaluating `light-dark()` and `color-mix()` the way CSS does, and rejects any token that does not reduce to a concrete color. The CSS keeps the `color-mix()` expressions; `platform-colors.ts` gets the resolved literals, because React Native can evaluate neither.
