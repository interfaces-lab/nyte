import path from "node:path";

// The StyleX PostCSS plugin collects every `stylex.create` in the docs into the
// `@stylex;` marker in global.css. @nyte-ai/ui arrives precompiled through
// @nyte-ai/ui/ui.css in its own `nyte-ui` layer. The Babel plugin in
// .babelrc.json does the matching JS transform. The rules nest under the
// `stylex` layer, which global.css orders below Tailwind's components and
// utilities.
//
// Paths are absolute and derived from process.cwd(): Next evaluates this file
// under a virtual URL, so import.meta.url does not point at the package.
const docsRoot = process.cwd();
const workspaceRoot = path.resolve(docsRoot, "../..");

const config = {
  plugins: {
    "@stylexjs/postcss-plugin": {
      cwd: docsRoot,
      include: [
        path.join(docsRoot, "src/**/*.{ts,tsx}"),
        // `defineConsts` handles only inline where their definition is collected,
        // so a demo that reads `t`, `menu`, or `layer` needs these compiled here too.
        path.join(workspaceRoot, "packages/ui/src/{vars,schema,floating-surface}.stylex.ts"),
      ],
      useCSSLayers: { prefix: "stylex" },
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [
          [
            "@stylexjs/babel-plugin",
            {
              runtimeInjection: false,
              propertyValidationMode: "throw",
              unstable_moduleResolution: { type: "commonJS", rootDir: workspaceRoot },
            },
          ],
        ],
      },
    },
    "@tailwindcss/postcss": {},
  },
};

export default config;
