import path from "node:path";

// The StyleX PostCSS plugin collects every `stylex.create` in the docs and in
// @nyte-ai/ui into the `@stylex;` marker in global.css. The Babel plugin in
// .babelrc.json does the matching JS transform.
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
        path.join(workspaceRoot, "packages/ui/src/**/*.{ts,tsx}"),
      ],
      useCSSLayers: true,
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [
          [
            "@stylexjs/babel-plugin",
            {
              runtimeInjection: false,
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
