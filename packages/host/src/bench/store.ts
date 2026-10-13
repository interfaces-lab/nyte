import type { Store, StoreConnection } from "@nyte-ai/core";
import { SdkError } from "@nyte-ai/core";

/** Returns a view of `inner` for one kernel, and `sever()`, which cuts that kernel off as a dead process is cut off: after it, `open()` and every call through a connection the view opened reject `SdkError("unavailable", "The host crashed.")` without reaching `inner`, so nothing the abandoned kernel still does (a turn in flight, a lease renewal, a timer, its own `close()`) writes; a call already handed to `inner` completes. `kind` is `inner`'s; `close()` on the view never closes `inner`, which outlives every kernel the bench opens over it. */
export function severableStore(inner: Store): { readonly store: Store; sever(): void } {
  let severed = false;

  const guarded =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      severed ? Promise.reject(new SdkError("unavailable", "The host crashed.")) : call(...args);

  const view = (connection: StoreConnection): StoreConnection => ({
    objects: {
      put: guarded((object) => connection.objects.put(object)),
      get: guarded((id) => connection.objects.get(id)),
      putBlob: guarded((bytes) => connection.objects.putBlob(bytes)),
      blob: guarded((id) => connection.objects.blob(id)),
    },
    refs: {
      get: guarded((name) => connection.refs.get(name)),
      list: guarded((prefix) => connection.refs.list(prefix)),
      set: guarded((updates) => connection.refs.set(updates)),
      log: guarded((session, after, limit) => connection.refs.log(session, after, limit)),
      tail: guarded((session) => connection.refs.tail(session)),
    },
  });

  return {
    store: {
      kind: inner.kind,
      open: guarded(async () => view(await inner.open())),
      close: async () => undefined,
    },
    sever() {
      severed = true;
    },
  };
}
