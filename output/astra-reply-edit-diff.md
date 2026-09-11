Touched only [edit-diff.ts](/Users/workgyver/Developer/nyte/packages/core/src/tools/edit-diff.ts) and [tools.test.ts](/Users/workgyver/Developer/nyte/packages/core/test/tools.test.ts).

Cached fuzzy normalization and match results; assembled replacements forward. Preserved errors, result shape, offsets, and unchanged-line behavior. Added four regression cases.

Verification:

- Tests passed: 560 standard, 430 worker.
- Typecheck failed on four unrelated missing `Objects.chain` implementations.
- Oxlint failed only on the known `no-unsafe-finally` error.
- Oxfmt used `--check` to preserve concurrent work. Both touched files passed; unrelated `session-follow.ts` failed.

With N file length, E edit count, S total needle length, and T inserted text length:

- `applyEditsToNormalizedContent`: normalization O(E·N + S) → O(N + S); per-edit searches remain.
- `applyReplacements`: O(E·N) rebuilding → O(N + T + E) forward assembly.