# Repository instruction and README audit

Reviewed 2026-09-10. Scope: repository guidance, README coverage, package scripts, and documentation navigation. This is not a runtime correctness or security audit.

## OpenCode reference

Reviewed OpenCode's `v2` branch at commit `1c723c56fa942ec45f662abb1367a8d789acf071`:

- [Root AGENTS.md](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/AGENTS.md) defines shared coding rules and conventional commit and PR titles.
- [CONTRIBUTING.md](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/CONTRIBUTING.md) covers setup, the package map, verification, and contributions.
- [README.md](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/README.md) introduces the product and installation.
- [Code Mode instructions](https://github.com/anomalyco/opencode/blob/1c723c56fa942ec45f662abb1367a8d789acf071/packages/codemode/AGENTS.md) keep package constraints near their owner and require related docs and tests to follow behavior changes.

Nyte adopts this separation and title convention. Its existing pnpm workflow, static imports, and Node/Bun constraints remain authoritative. OpenCode-specific branch, generation, and release rules do not describe this repository.

OpenCode's `codemode` package runs code with access to explicitly supplied tools. Nyte has no corresponding package or named area. The initial guidance incorrectly reused that scope; the corrected examples use `core` and `tui`, and scopes must refer to existing Nyte packages or repository areas.

## Findings addressed

| Finding | Change |
| --- | --- |
| No written commit subject or PR title convention | Added types, scopes, imperative summaries, breaking-change syntax, and examples to root AGENTS.md |
| Instruction scope and documentation ownership were implicit | Added ancestor-file guidance, rules for nested instructions, and README ownership |
| No contributor guide or package map | Added CONTRIBUTING.md and linked it from the root README |
| Core and desktop had no package landing README | Added concise introductions, verified package commands, and links to existing detailed guides |
| Docs README referred to nonexistent root `pnpm dev` and stale source paths | Corrected the command and route/source locations |
| Generic verification guidance missed packages without tests and docs' differently named typecheck | Documented script availability and the separate `types:check` command |
| Markdown formatting coverage was undocumented | Documented the `**/*.md` formatter exclusion and manual checks |

## Remaining coverage

Of 15 direct workspace packages, 11 now have a root README. AI, plugin, schema, and demo still lack one. The contributor map identifies each, and plugin links to its existing examples. AI catalog maintenance and demo setup are useful candidates for future package guides.

Five AGENTS.md files cover the root, core, desktop, TUI, and docs. More instruction files are useful only where a package has constraints beyond the root rules. Adding one to every directory would repeat guidance without adding information.

Existing kernel, TUI, QA, desktop update, and design documentation had concurrent edits. This change links to those files without rewriting them. Generated Next.js instructions are preserved.

## Verification

Compared documented commands with root and package manifests, checked source and route paths, and checked local Markdown link targets in the edited guides. Markdown is excluded by the repository formatter, so no formatter pass is claimed. Application builds and tests are unnecessary for these Markdown-only edits.
