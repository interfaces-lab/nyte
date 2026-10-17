/** A content hash of core's fold code, every file in `src/fold` but this one, that stamps fold checkpoints, so a fold another version of that code computed is never restored. `test/fold-code.test.ts` recomputes it and fails until it is updated here. */
export const FOLD_CODE = "f898290cae490a88";
