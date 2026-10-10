import type { Json, SessionId } from "@nyte-ai/schema";
import type { PluginStorage } from "./connection.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { decodeKvValue } from "./records.ts";
import { kvRef } from "./refs.ts";
import { commit, isJsonObject, put, requireSession } from "./session-state.ts";

const keys = new WeakMap<Kernel, Promise<CryptoKey>>();

/** Returns one plugin's storage in a session. Keys live at `kvRef(scope, owner, key)` with scope `session:<session>` by default, `host` through `at("host")` and `workspace:<workspace>` through `at("workspace")`, the workspace read from the session record at each call; each value is an envelope of kind `kv`, set without `expect` (last write wins); `get` widens the stored `Json` to `T` unchecked (§35g); `delete` removes the ref and `keys` lists the scope's refs. `secrets` is host-scope at `kvRef("secret", owner, key)` (§35e): each value AES-256-GCM encrypted under `kernel.secrets.key()` (imported once per kernel through `globalThis.crypto.subtle`) with a random 12-byte IV, stored as `{ iv, ciphertext }` in base64, never in a view, an event or a log. Without `kernel.secrets`, `secrets.set` throws `SdkError("unavailable")` and `secrets.get` resolves undefined. */
export function createPluginStorage(
  kernel: Kernel,
  input: { readonly owner: string; readonly session: SessionId },
): PluginStorage {
  const { owner, session } = input;

  const scoped = (scope: "host" | "workspace" | "session"): PluginStorage => {
    const prefix = async (): Promise<string> => {
      if (scope === "host") return "host";

      if (scope === "session") return `session:${session}`;

      return `workspace:${(await requireSession(kernel, session)).record.workspace}`;
    };

    const name = async (key: string): Promise<string> => kvRef(await prefix(), owner, key);

    /** The one unchecked widening of storage: a stored value is `Json`, returned as `T` (§35g). */
    function get<T extends Json>(key: string): Promise<T | undefined>;
    async function get(key: string): Promise<Json | undefined> {
      return readKv(kernel, await name(key));
    }

    return {
      get,
      async set(key, value) {
        await commit(kernel, [{ name: await name(key), target: await put(kernel, "kv", value) }]);
      },
      async delete(key) {
        await commit(kernel, [{ name: await name(key), target: null }]);
      },
      async keys() {
        const start = kvRef(await prefix(), owner, "");

        return (await kernel.store.refs.list(start)).map((ref) => ref.name.slice(start.length));
      },
      at: scoped,
      secrets,
    };
  };

  const secrets: PluginStorage["secrets"] = {
    async get(key) {
      const sealed = await readKv(kernel, kvRef("secret", owner, key));

      if (sealed === undefined || !isJsonObject(sealed)) return undefined;
      const { iv, ciphertext } = sealed;
      const cipher = keyOf(kernel);

      if (cipher === null || typeof iv !== "string" || typeof ciphertext !== "string")
        return undefined;

      const plain = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Uint8Array.fromBase64(iv) },
        await cipher,
        Uint8Array.fromBase64(ciphertext),
      );

      return new TextDecoder().decode(plain);
    },
    async set(key, value) {
      const cipher = keyOf(kernel);

      if (cipher === null)
        throw new SdkError("unavailable", "This host has no secrets key, so it stores no secrets.");
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

      const sealed = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await cipher,
          new TextEncoder().encode(value),
        ),
      );

      await commit(kernel, [
        {
          name: kvRef("secret", owner, key),
          target: await put(kernel, "kv", { iv: iv.toBase64(), ciphertext: sealed.toBase64() }),
        },
      ]);
    },
    async delete(key) {
      await commit(kernel, [{ name: kvRef("secret", owner, key), target: null }]);
    },
  };

  return scoped("session");
}

/** Returns the value a kv ref holds, or undefined when the ref is absent. */
export async function readKv(kernel: Kernel, name: string): Promise<Json | undefined> {
  const ref = await kernel.store.refs.get(name);

  return ref === null || ref.target === null
    ? undefined
    : decodeKvValue(await kernel.store.objects.get(ref.target));
}

/** Returns the kernel's AES-256-GCM key, imported from `kernel.secrets` on first use; null without one. A key that is not 32 bytes rejects `invalid`. */
function keyOf(kernel: Kernel): Promise<CryptoKey> | null {
  const source = kernel.secrets;

  if (source === null) return null;
  const known = keys.get(kernel);

  if (known !== undefined) return known;

  const imported = source.key().then((bytes) => {
    if (bytes.length !== 32)
      throw new SdkError("invalid", `The secrets key is ${bytes.length} bytes; AES-256 needs 32.`);

    return globalThis.crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  });

  keys.set(kernel, imported);

  return imported;
}
