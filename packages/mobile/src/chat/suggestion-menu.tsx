/**
 * The `@` and `/` menu that grows above the composer capsule. It is a plain
 * list on a solid surface: the keyboard stays up, the draft stays visible, and
 * one tap writes the choice. The list scrolls rather than pushing the capsule.
 */
import { ScrollView } from "react-native";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { controls, spacing, surfaces, textStyles, tokens, useTheme } from "../theme.ts";
import {
  suggestionIcon,
  suggestionKey,
  suggestionLabel,
  suggestionNotice,
  type Completion,
  type Suggestion,
} from "./completions.ts";

/**
 * Four rows and a hint of the next: enough to choose from, short enough to keep
 * the draft and its capsule in view. Rows carry two lines, so the cap is not a
 * multiple of the touch target.
 */
const MAX_HEIGHT = 244;

export function SuggestionMenu({
  completion,
  onAccept,
}: {
  completion: Completion;
  onAccept: (suggestion: Suggestion) => void;
}) {
  const theme = useTheme();
  const notice = suggestionNotice(completion);
  const rows = completion.list.kind === "ready" ? completion.list.value : [];

  return (
    <html.div style={[surfaces.panel, styles.menu]}>
      {notice === undefined ? (
        <ScrollView
          style={{ maxHeight: MAX_HEIGHT }}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
        >
          {rows.map((suggestion, index) => (
            <html.button
              key={suggestionKey(suggestion)}
              aria-label={`${suggestionLabel(suggestion)}, ${suggestion.detail}`}
              onClick={() => onAccept(suggestion)}
              style={[styles.row, index > 0 && styles.divided]}
            >
              <SymbolView
                name={suggestionIcon(suggestion)}
                size={controls.icon}
                tintColor={theme.muted}
              />
              <html.div style={styles.text}>
                <html.span style={[textStyles.body, styles.label]}>
                  {suggestionLabel(suggestion)}
                </html.span>
                {suggestion.detail === "" ? null : (
                  <html.span style={[textStyles.caption, styles.detail]}>
                    {suggestion.detail}
                  </html.span>
                )}
              </html.div>
            </html.button>
          ))}
        </ScrollView>
      ) : (
        <html.div style={styles.notice} aria-live="polite">
          <html.span
            style={[textStyles.secondary, completion.list.kind === "failed" && styles.failed]}
          >
            {notice}
          </html.span>
        </html.div>
      )}
    </html.div>
  );
}

const styles = css.create({
  menu: {
    display: "flex",
    flexDirection: "column",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
    paddingInline: spacing.md,
    paddingBlock: spacing.sm,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  divided: {
    borderTopWidth: controls.hairline,
    borderTopStyle: "solid",
    borderTopColor: tokens.separator,
  },
  text: { display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 },
  // One line each: a long path is truncated rather than growing the row.
  label: { color: tokens.foreground, lineClamp: 1 },
  detail: { color: tokens.muted, lineClamp: 1 },
  notice: {
    display: "flex",
    justifyContent: "center",
    minHeight: controls.touchTarget,
    padding: spacing.md,
  },
  failed: { color: tokens.danger },
});
