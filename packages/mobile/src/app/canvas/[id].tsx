import { useLocalSearchParams } from "expo-router";
import { CanvasScreen } from "../../chat/canvas-screen.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { parsePartId, parseSessionId } from "../../view-helpers.ts";

export default function Canvas() {
  const params = useLocalSearchParams<{ id: string; part?: string }>();
  const sessionId = parseSessionId(Array.isArray(params.id) ? params.id[0] : params.id);
  const part = parsePartId(Array.isArray(params.part) ? params.part[0] : params.part);

  if (sessionId === undefined || part === undefined) {
    return <EmptyState title="Canvas not found" description="This canvas doesn't exist." />;
  }

  return <CanvasScreen sessionId={sessionId} part={part} />;
}
