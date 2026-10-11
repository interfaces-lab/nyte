import { useLocalSearchParams } from "expo-router";
import { ChatContainer } from "../../chat/chat-container.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { sessionIdOf } from "../../view-helpers.ts";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const parsed = sessionIdOf(rawId);

  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This conversation doesn't exist." />;
  }

  return <ChatContainer sessionId={parsed} />;
}
