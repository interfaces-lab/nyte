import { StyleSheet, useWindowDimensions } from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { css, html } from "react-strict-dom";
import { controls, menu, spacing, textStyles, tokens, typography } from "../theme.ts";
import { CompletionIcon } from "../ui/completion-icon.tsx";
import { GlassSurface } from "./composer-glass.tsx";
import {
  suggestionKey,
  suggestionLabel,
  suggestionNotice,
  type Completion,
  type Suggestion,
} from "./completions.ts";

export function SuggestionMenu({
  completion,
  onAccept,
  cardHeight,
  cardDock,
}: {
  completion: Completion;
  onAccept: (suggestion: Suggestion) => void;
  cardHeight: SharedValue<number>;
  cardDock: SharedValue<number>;
}) {
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const notice = suggestionNotice(completion);
  const rows = completion.list.kind === "ready" ? completion.list.value : [];

  const rowHeight = Math.max(
    controls.touchTarget,
    (typography.body.lineHeight + typography.caption.lineHeight) * fontScale + menu.padding * 2,
  );

  const contentHeight = notice === undefined ? rows.length * rowHeight : controls.touchTarget;

  const viewport = useAnimatedStyle(() => ({
    height: Math.max(
      controls.touchTarget + menu.padding * 2,
      Math.min(
        contentHeight + menu.padding * 2,
        menu.maxHeight,
        windowHeight - cardDock.get() - cardHeight.get() - headerHeight - spacing.sm,
      ),
    ),
  }));

  return (
    <Animated.View style={viewport}>
      <GlassSurface isInteractive style={layout.glass}>
        {notice === undefined ? (
          <LegendList
            key={`${completion.trigger.kind}:${completion.trigger.query}`}
            data={rows}
            keyExtractor={suggestionKey}
            estimatedItemSize={rowHeight}
            style={layout.list}
            contentContainerStyle={layout.content}
            recycleItems
            maintainVisibleContentPosition={false}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator
            nestedScrollEnabled
            renderItem={({ item }) => (
              <html.button
                aria-label={`${suggestionLabel(item)}, ${item.detail}`}
                onClick={() => onAccept(item)}
                style={styles.row(rowHeight)}
              >
                {item.kind === "file" ? (
                  <CompletionIcon kind="file" path={item.label} />
                ) : (
                  <CompletionIcon kind={item.kind} />
                )}
                <html.div style={styles.text}>
                  <html.span style={[textStyles.body, styles.label]}>
                    {suggestionLabel(item)}
                  </html.span>
                  {item.detail === "" ? null : (
                    <html.span style={[textStyles.caption, styles.detail]}>{item.detail}</html.span>
                  )}
                </html.div>
              </html.button>
            )}
          />
        ) : (
          <html.div style={styles.notice} aria-live="polite">
            <html.span
              style={[textStyles.secondary, completion.list.kind === "failed" && styles.failed]}
            >
              {notice}
            </html.span>
          </html.div>
        )}
      </GlassSurface>
    </Animated.View>
  );
}

const layout = StyleSheet.create({
  glass: { flex: 1, borderRadius: menu.radius, overflow: "hidden" },
  list: { flex: 1 },
  content: { padding: menu.padding },
});

const styles = css.create({
  row: (height: number) => ({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: menu.gap,
    minHeight: height,
    paddingInline: spacing.sm,
    paddingBlock: menu.padding,
    borderWidth: 0,
    borderRadius: spacing.sm,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  }),
  text: { display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 },
  label: { color: tokens.foreground, lineClamp: 1 },
  detail: { color: tokens.muted, lineClamp: 1 },
  notice: {
    display: "flex",
    justifyContent: "center",
    flexGrow: 1,
    minHeight: controls.touchTarget,
    padding: spacing.md,
  },
  failed: { color: tokens.danger },
});
