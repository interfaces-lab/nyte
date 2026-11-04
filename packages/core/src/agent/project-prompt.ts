import { projectPrompt, projectRole } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { PromptSection } from "../contract/plugin.ts";
import { decodeProjectRecord } from "../contract/records.ts";
import type { SessionRecord } from "../contract/records.ts";
import { projectRef } from "../store/refs.ts";
import { load } from "../store/session.ts";

/** Before the context files (order 10 is theirs), so a folder's own rules still have the last word. */
const ORDER = 5;

/**
 * The system prompt section a session in a project reads: its role's framing, then the brief. The
 * project is read on every request, so an edited brief reaches the next one. A session in none,
 * or in a project since removed, reads none.
 */
export async function projectSections(
  kernel: Kernel,
  record: SessionRecord,
): Promise<readonly PromptSection[]> {
  if (record.project === undefined) return [];

  const found = await load(
    kernel.store,
    await kernel.store.refs.get(projectRef(record.project)),
    decodeProjectRecord,
  );

  if (found === null) return [];

  return [
    {
      id: "project",
      order: ORDER,
      text: projectPrompt(found.record, projectRole(found.record, record.id)),
    },
  ];
}
