import { useLocalSearchParams } from "expo-router";
import { ReviewScreen } from "../../review/review-screen.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { parseSessionId } from "../../view-helpers.ts";

export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const parsed = parseSessionId(rawId);

  if (parsed === undefined) {
    return <EmptyState title="Chat not found" description="This chat doesn't exist." />;
  }

  return <ReviewScreen sessionId={parsed} />;
}
