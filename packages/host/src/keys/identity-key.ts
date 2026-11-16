import { join } from "node:path";
import type { HostId } from "@nyte-ai/schema";
import type { ListenOptions } from "@nyte-ai/core";
import { seedSigner } from "./identity.ts";
import { readKeyFile } from "./key-file.ts";

export async function identitySigner(
  id: HostId,
  home: string,
): Promise<NonNullable<ListenOptions["identity"]>> {
  return seedSigner(id, await readKeyFile(join(home, ".nyte", "identity.key"), "identity key"));
}
