import type {
  Configuration,
  Connection,
  Delivery,
  Head,
  HeadName,
  SessionCatalogView,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/sdk";
import type { DraftContent } from "../media/attachments.ts";
import type { SendOutcome } from "./remote-chat.ts";

/** A composer that starts a conversation in the chosen folder. */
type NewTarget = { kind: "new" };

/** A composer that follows up in an open session, on the head the user is viewing. */
export type SessionTarget = {
  kind: "session";
  sessionId: SessionId;
  head: string;
  heads: readonly HeadName[];
  config: Configuration | null;
  workspace: WorkspaceId | undefined;
  catalog: SessionCatalogView;
  sending: boolean;
  running: boolean;
  stopping: boolean;
  error: string | undefined;
  onSend: (content: DraftContent, delivery?: Delivery) => Promise<SendOutcome>;
  onStop: () => void;
  onChooseHead: (head: HeadName) => void;
};

/** Where the composer's message goes. */
export type ComposerTarget = NewTarget | SessionTarget;

/** Open the head the session composer writes to; a head the session no longer lists falls back to the session. */
export function openHead(client: Connection, session: SessionTarget): Head {
  const handle = client.session(session.sessionId);
  const name = session.heads.find((head) => head === session.head);

  return name === undefined ? handle : handle.head(name);
}
