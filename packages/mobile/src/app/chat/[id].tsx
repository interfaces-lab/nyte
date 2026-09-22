import { useLocalSearchParams } from "expo-router";
import { sessionId, type SessionId } from "@nyte-ai/protocol";
import { ChatContainer } from "../../chat/chat-container.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  let parsed: SessionId | undefined;

  try {
    parsed = sessionId(rawId);
  } catch {
    parsed = undefined;
  }

  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This conversation doesn't exist." />;
  }

  return <ChatContainer sessionId={parsed} />;
}
