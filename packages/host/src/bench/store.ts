import type { Store } from "@nyte-ai/core";

/** Returns a view of `inner` for one kernel, and `sever()`, which cuts that kernel off as a dead process is cut off: after it, `open()` and every call through a connection the view opened reject `SdkError("unavailable", "The host crashed.")` without reaching `inner`, so nothing the abandoned kernel still does (a turn in flight, a lease renewal, a timer, its own `close()`) writes; a call already handed to `inner` completes. `kind` is `inner`'s; `close()` on the view and on its connections never closes `inner`, which outlives every kernel the bench opens over it. */
export function severableStore(inner: Store): { readonly store: Store; sever(): void } {
  throw new Error("not implemented");
}
