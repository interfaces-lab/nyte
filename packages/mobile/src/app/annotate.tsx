import { router, useLocalSearchParams } from "expo-router";
import { AnnotateScreen } from "../annotate/annotate-screen.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";

export default function Annotate() {
  const { imageId, uri } = useLocalSearchParams<{ imageId: string; uri: string }>();
  const id = Array.isArray(imageId) ? imageId[0] : imageId;
  const source = Array.isArray(uri) ? uri[0] : uri;

  if (id === undefined || id === "" || source === undefined || source === "") {
    return (
      <EmptyState title="No photo to mark up" description="Attach a photo first, then open markup.">
        <GlassButton label="Go back" onPress={() => router.back()} />
      </EmptyState>
    );
  }

  return <AnnotateScreen imageId={id} uri={source} />;
}
