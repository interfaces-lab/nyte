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

The generated CSS variables and the typed StyleX map come from `platform-tokens.stylex.ts`. Use `className` for consumer layout, including Tailwind utilities, and `xstyle` for a deliberate StyleX override. Reuse Base UI parts before creating a new wrapper, and keep domain adapters in the app.
