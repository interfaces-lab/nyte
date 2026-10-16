import { stylex } from "@nyte-ai/ui/stylex";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [
    fumadocsMdx(),
    stylex.vite({
      useCSSLayers: true,
      // Older targets make lightningcss polyfill the tokens' light-dark() and
      // relative colours with variables nothing defines.
      lightningcssOptions: { targets: { chrome: 123 << 16 } },
    }),
    tanstackStart({ srcDirectory: "src" }),
    react({ compiler: true }),
    tailwindcss(),
    nitro(),
  ],
  optimizeDeps: {
    exclude: ["@nyte-ai/ui"],
    include: [
      "alert-dialog",
      "autocomplete",
      "avatar",
      "button",
      "checkbox",
      "collapsible",
      "combobox",
      "context-menu",
      "dialog",
      "field",
      "input",
      "menu",
      "merge-props",
      "meter",
      "number-field",
      "popover",
      "preview-card",
      "select",
      "slider",
      "switch",
      "tabs",
      "toast",
      "toggle",
      "toggle-group",
      "toolbar",
      "tooltip",
      "use-render",
    ]
      .map((part) => `@nyte-ai/ui > @base-ui/react/${part}`)
      .concat([
        "@nyte-ai/ui > central-icons",
        "@nyte-ai/ui > central-icons-filled",
        "@nyte-ai/ui > class-variance-authority",
        "@nyte-ai/ui > motion/react",
        "@nyte-ai/ui > @nivo/axes",
        "@nyte-ai/ui > @nivo/bar",
        "@nyte-ai/ui > @nivo/line",
        "@nyte-ai/ui > @shadcn/react/message-scroller",
        "@nyte-ai/ui > @shadcn/react/questionnaire",
        "cn",
      ]),
  },
  /* StyleX compiles @nyte-ai/ui from source here, so resolve its `nyte-source` condition. */
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  ssr: { resolve: { conditions: ["nyte-source", ...defaultServerConditions] } },
});
