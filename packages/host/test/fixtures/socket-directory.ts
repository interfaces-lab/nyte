import { compile, SessionsChangeType, withJson } from "@nyte-ai/schema";
import type { JsonSchema } from "@nyte-ai/schema";
import { decodeOutput } from "@nyte-ai/protocol";
import type { DirectoryStore } from "@nyte-ai/protocol";
import type { Client } from "./socket-client.ts";

const sessionsChanges = compile(withJson(SessionsChangeType));

export function hostChange(frame: JsonSchema): boolean {
  return frame.scope === "host" && frame.kind === "change";
}

export function applySessions(store: DirectoryStore, frames: readonly JsonSchema[]): number {
  let applied = 0;

  for (const frame of frames) {
    if (hostChange(frame) && sessionsChanges.Check(frame)) {
      store.apply(frame);
      applied += 1;
    }
  }

  return applied;
}

export async function readDirectory(client: Client, seq?: number) {
  const read = await client.call("sessions.read", seq === undefined ? {} : { resume: { seq } });
  const answered = client.frames.findIndex((frame) => frame.output === read);

  return { read: decodeOutput("sessions.read", read), answered };
}
