import { join } from "node:path";
import type { HostId } from "@nyte-ai/schema";
import type { ListenOptions } from "@nyte-ai/core";
import { seedSigner } from "./identity.ts";
import { readKeyFile } from "./key-file.ts";

/**
 * Returns the Node host's identity signer (§50a): `seedSigner` over the
 * Ed25519 seed in `<home>/.nyte/identity.key`, 32 raw bytes minted `0600` by
 * `link` on first use as the secrets key is. The file is not encrypted; it is
 * a signing key, protected as ssh protects one, and it never touches the
 * secrets key. Named apart from core's `hostIdentity(store)`, which reads or
 * mints the host's id.
 */
export async function identitySigner(
  id: HostId,
  home: string,
): Promise<NonNullable<ListenOptions["identity"]>> {
  return seedSigner(id, await readKeyFile(join(home, ".nyte", "identity.key"), "identity key"));
}
