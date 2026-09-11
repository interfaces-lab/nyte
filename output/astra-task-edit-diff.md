Repository: this directory (pnpm monorepo, TypeScript 7, Node 26). Read AGENTS.md first and follow it (no `any`, no `as` casts, top-level imports, `.ts` extensions, never `git stash`; other agents edit this tree concurrently, so touch only packages/core/src/tools/edit-diff.ts and packages/core/test/tools.test.ts / a new focused test).

Task, in packages/core/src/tools/edit-diff.ts, behavior-preserving:

1. `applyEditsToNormalizedContent` re-normalizes the whole file per edit: `fuzzyFindText` calls `normalizeForFuzzyMatch(content)` (NFKC + line map + regex passes) whenever the exact match misses, once in `initialMatches`, again in the second matching loop, and `countOccurrences` normalizes unconditionally per edit. Compute `normalizeForFuzzyMatch(normalizedContent)` at most once per call (lazily, only when some edit needs it) and the normalized needle once per edit, and pass them through so matching and duplicate counting reuse them. Keep fuzzy duplicate detection even when the exact match succeeds, exactly as today. Drop the duplicated `initialMatches` pass if a single pass can decide `usedFuzzyMatch` and then re-match only the edits that need the fuzzy base.
2. `applyReplacements` rebuilds the whole string per replacement (O(R·N) in reverse). Replacements are sorted by `matchIndex` and non-overlapping (that is validated before), so do one forward pass: slice the gaps between replacements and join with the new texts. Same result, same `offset` semantics.

Constraints: keep every error message and the `AppliedEditsResult` shape byte-identical; keep `applyReplacementsPreservingUnchangedLines` behavior. Add or extend a test in packages/core/test/tools.test.ts covering: multiple edits where one needs fuzzy matching and another is exact; a duplicate that only exists in fuzzy space; and edits applied in forward order producing the same output as before for three non-adjacent replacements.

Verify: `pnpm --dir packages/core test`, `pnpm --dir packages/core typecheck`, `pnpm oxlint packages/core`, `pnpm oxfmt packages/core`. A pre-existing oxlint `no-unsafe-finally` error in packages/core/src/kernel/compaction.ts is not yours.

Final message: files touched, what changed, test results, and the before/after complexity of the two functions in one line each.
