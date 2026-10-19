import type { RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import { runRef } from "../store/refs.ts";
import { load } from "../store/session.ts";

const NONE: ReadonlySet<string> = new Set();

async function readRequires(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<readonly string[] | undefined> {
  const found = await load(
    kernel.store,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  return found?.record.requires;
}

export async function hiddenOwners(
  kernel: Kernel,
  session: SessionId,
  run: RunId | null,
): Promise<ReadonlySet<string>> {
  const mine = kernel.presence?.member.capabilities ?? [];

  if (mine.length === 0 || run === null) return NONE;

  const requires = await readRequires(kernel, session, run);

  return requires === undefined ? NONE : new Set(mine.filter((owner) => !requires.includes(owner)));
}

export async function missingCapabilities(
  kernel: Kernel,
  session: SessionId,
  run: RunId | null,
): Promise<readonly string[]> {
  if (run === null) return [];
  const mine = kernel.presence?.member.capabilities ?? [];
  const requires = (await readRequires(kernel, session, run)) ?? [];

  return requires.filter((capability) => !mine.includes(capability));
}
