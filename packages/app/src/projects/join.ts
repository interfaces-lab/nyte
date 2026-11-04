import { sessionTitle } from "@nyte-ai/plugin/client/presentation";
import type { ProjectId, SessionId } from "@nyte-ai/schema";
import { toast } from "@nyte-ai/ui/toast";
import { sideChatExcerpt } from "../chat/side-chat/side-chats.ts";
import { errorMessage } from "../contract/errors.ts";
import { chatStore } from "../data/chat-store.ts";
import { connected } from "../data/connection.ts";
import { findProject } from "../data/projects.ts";
import { findSessionRow } from "../data/session-rows.ts";

/**
 * Moves chat `session` into project `id` and hands it to the project's lead: the lead gets its
 * conversation as an excerpt, with the chat's id to follow it by. A chat already there, or the
 * lead itself, moves nowhere.
 */
export async function joinProject(session: SessionId, id: ProjectId): Promise<void> {
  const project = findProject(id);
  const row = findSessionRow(session);

  if (project === undefined || row?.project === id || project.lead === session) return;

  try {
    const connection = await connected();
    const outcome = await connection.session(session).update({ project: id });

    if (outcome.kind !== "updated") throw new Error("The chat is busy moving folders.");

    if (project.lead === null) return;
    const title = row === undefined ? "A chat" : sessionTitle(row);
    const excerpt = sideChatExcerpt(session, title, chatStore(session).value);

    await connection.session(project.lead).send([
      {
        kind: "text",
        text: `I moved “${title}” (chat ${session}) into this project. Follow it as one of your units: read it with read_agent, steer it with send and collect its answer with await.`,
      },
      { kind: "excerpt", source: excerpt.source, text: excerpt.text },
    ]);
  } catch (cause) {
    toast.add({ type: "error", title: `Couldn't move the chat: ${errorMessage(cause)}` });
  }
}
