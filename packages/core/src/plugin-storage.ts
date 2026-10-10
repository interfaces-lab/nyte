import type { SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { PluginStorage } from "./connection.ts";
import type { Kernel } from "./kernel.ts";

/** Returns one plugin's storage in a session. Keys live at `kvRef(scope, owner, key)` with scope `session:<session>` by default, `host` through `at("host")` and `workspace:<workspace>` through `at("workspace")`; each value is an envelope of kind `kv`, set without `expect` (last write wins); `delete` removes the ref and `keys` lists the scope's refs. `secrets` is host-scope under scope `secret:<owner>`: each value AES-256-GCM encrypted under `kernel.secrets.key()` (imported once through `globalThis.crypto.subtle`) with a random 12-byte IV, stored as `{ iv, ciphertext }` in base64, never in a view, an event or a log. Without `kernel.secrets`, `secrets.set` throws `SdkError("unavailable")` and `secrets.get` resolves undefined. */
export function createPluginStorage(
  kernel: Kernel,
  input: { readonly owner: string; readonly session: SessionId; readonly workspace: WorkspaceId },
): PluginStorage {
  throw new Error("not implemented");
}
