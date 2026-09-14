import { router } from "expo-router";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";

export default function NotFound() {
  return (
    <EmptyState title="Page not found" description="This page doesn't exist in Nyte.">
      <GlassButton label="Back to Inbox" onPress={() => router.replace("/")} />
    </EmptyState>
  );
}
