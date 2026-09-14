import { useLocalSearchParams } from "expo-router";
import { sessionId, type SessionId } from "@nyte-ai/protocol";
import { ChangesScreen } from "../../chat/changes-screen.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { useHost } from "../../connection/host-context.tsx";

export default function Changes() {
  const { client } = useHost();
  const { id, path, source } = useLocalSearchParams<{
    id: string;
    path?: string;
    source?: string;
  }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const rawPath = Array.isArray(path) ? path[0] : path;
  const rawSource = Array.isArray(source) ? source[0] : source;
  let parsed: SessionId | undefined;
  try {
    parsed = sessionId(rawId);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This conversation doesn't exist." />;
  }
  return (
    <ChangesScreen
      client={client}
      sessionId={parsed}
      initialPath={rawPath === "" ? undefined : rawPath}
      initialSource={rawSource === "mac" ? "mac" : undefined}
    />
  );
}
