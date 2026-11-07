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

type NewTarget = { kind: "new" };

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

export type ComposerTarget = NewTarget | SessionTarget;

export function openHead(client: Connection, session: SessionTarget): Head {
  const handle = client.session(session.sessionId);
  const name = session.heads.find((head) => head === session.head);

  return name === undefined ? handle : handle.head(name);
}
