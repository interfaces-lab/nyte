import { useLocalSearchParams } from "expo-router";
import { ChangesScreen } from "../../chat/changes-screen.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { parseSessionId } from "../../view-helpers.ts";
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
  const parsed = parseSessionId(rawId);

  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This chat doesn't exist." />;
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
