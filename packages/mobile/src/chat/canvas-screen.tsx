import { ActivityIndicator } from "react-native";
import { Stack } from "expo-router/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import { canvas } from "@nyte-ai/plugin/canvas/schema";
import type { PartId, SessionId } from "@nyte-ai/sdk";
import { describeHostError } from "../connection/connection.ts";
import { useHost } from "../connection/host-context.tsx";
import { useWatch } from "../connection/use-watch.ts";
import { tokens, useTheme } from "../theme.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { CanvasWebView } from "./canvas-frame.tsx";

const FILL = { kind: "fill" } as const;

/**
 * One canvas filling the screen under its title. It watches the part itself rather than the chat's
 * view, so it finds a canvas past the messages the chat holds and redraws when the agent replaces it.
 */
export function CanvasScreen({ sessionId, part }: { sessionId: SessionId; part: PartId }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const handle = useHost().client.session(sessionId).part(part);
  const [watched] = useWatch(handle);

  const view =
    watched.kind === "ready" ? watched.value : watched.kind === "failed" ? watched.last : undefined;

  if (view === undefined && watched.kind === "failed")
    return (
      <EmptyState title="Couldn't load the canvas" description={describeHostError(watched.error)} />
    );

  if (view === undefined)
    return (
      <html.div style={styles.loading}>
        <ActivityIndicator color={theme.muted} />
      </html.div>
    );

  if (view === null)
    return <EmptyState title="Canvas not found" description="It's no longer in this chat." />;

  const checked = canvas.state["~standard"].validate(view.state);

  if (checked instanceof Promise || checked.issues !== undefined)
    return <EmptyState title="Canvas unavailable" description="This canvas can't be shown." />;
  const state = checked.value;

  return (
    <html.div style={[styles.screen, styles.bottomInset(insets.bottom)]}>
      <Stack.Title>{state.title}</Stack.Title>
      <CanvasWebView
        canvas={state}
        size={FILL}
        onReport={(message) => void handle.act("report", { message }).catch(() => undefined)}
      />
    </html.div>
  );
}

const styles = css.create({
  screen: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.canvas,
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom }),
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
  },
});
