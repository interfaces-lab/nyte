import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import { spacing, textStyles } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { COMPOSER } from "./composer-geometry.ts";

/**
 * A subagent works for the conversation that started it, so its own conversation has no composer:
 * this bar sits where the composer would, names the parent, leads back to it, and stops the subagent.
 */
export function SubagentBar({
  parentName,
  running,
  stopping,
  gutters,
  onOpenParent,
  onStop,
}: {
  parentName: string;
  running: boolean;
  stopping: boolean;
  gutters: { left: number; right: number };
  onOpenParent: () => void;
  onStop: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingLeft: gutters.left,
        paddingRight: gutters.right,
        paddingTop: spacing.xs,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
      }}
    >
      <html.div style={styles.bar}>
        <html.div style={styles.text}>
          <html.span style={[textStyles.body, styles.line]}>Runs on its own</html.span>
          <html.span
            style={[textStyles.caption, styles.line]}
          >{`Subagent of ${parentName}`}</html.span>
        </html.div>
        {running ? (
          <GlassButton
            label={stopping ? "Stopping…" : "Stop"}
            systemImage="stop.fill"
            size="compact"
            busy={stopping}
            onPress={onStop}
          />
        ) : null}
        <GlassButton
          label="Open Parent"
          systemImage="arrow.up.backward"
          size="compact"
          onPress={onOpenParent}
        />
      </html.div>
    </View>
  );
}

const styles = css.create({
  bar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: COMPOSER.height,
  },
  text: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  line: { lineClamp: 1, textAlign: "start" },
});
