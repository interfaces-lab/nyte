import { useLocalSearchParams } from "expo-router";
import { ChatContainer } from "../../chat/chat-container.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { parseSessionId } from "../../view-helpers.ts";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const parsed = parseSessionId(rawId);

  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This chat doesn't exist." />;
  }

  return <ChatContainer sessionId={parsed} />;
}
