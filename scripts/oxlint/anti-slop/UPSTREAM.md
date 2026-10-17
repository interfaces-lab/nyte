# Upstream

- Source: https://github.com/dmmulroy/anti-slop, `skills/install-anti-slop/assets/anti-slop`
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (skill folder tree `89044d21c75a367eac1ddbaf208e650b1a7d5820`)
- Copied from `anomalyco/opencode` branch `v2`, `script/oxlint/anti-slop/`.

## Installed paths

- `scripts/oxlint/anti-slop/index.ts`: generic rules, registered as the `anti-slop` plugin.
- `scripts/oxlint/anti-slop/vendor/eslint-stylistic/`: vendored padding-line logic with its own `LICENSE` and `UPSTREAM.md`.

## Deviations

- The Effect rules (`anti-slop-effect`) are not installed; nothing here depends on `effect`.
- The local `no-of-lookup-names` rule lives in `scripts/oxlint/nyte-code`, so this directory holds only upstream code. The root `ignorePatterns` skip it as vendored.
- `no-chained-type-assertions`, `no-widen-then-assert` and `require-safety-comment-for-type-assertion` are removed: `typescript/consistent-type-assertions` with `assertionStyle: "never"` rejects every non-`as const` assertion they inspected.
- `oxlint.config.ts` enables the rules for `packages/app`, `packages/desktop`, `packages/ui` and `scripts`.
- The rules run at `warn`, not `error`, while existing findings are fixed package by package.
