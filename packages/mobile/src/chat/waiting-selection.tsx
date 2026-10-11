import type { ActOutcome } from "@nyte-ai/sdk";
import { SymbolView } from "expo-symbols";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { TextInput } from "react-native";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import type { OpenQuestion } from "../view-helpers.ts";
import { controls, useTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";

type WaitingSelectionProps = {
  question: OpenQuestion;
  onReply: (choice: string) => Promise<ActOutcome<unknown> | undefined>;
};

type AnswerState =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "failed" }
  | { kind: "settled"; outcome: ActOutcome<unknown> };

export function WaitingSelection({ question, onReply }: WaitingSelectionProps): ReactElement {
  return <SelectionForm key={question.id} question={question} onReply={onReply} />;
}

/** One choice of the question's options, or the user's own words. */
function SelectionForm({ question, onReply }: WaitingSelectionProps): ReactElement {
  const theme = useTheme();
  const titleId = useId();
  const [selected, setSelected] = useState<string>();
  const [other, setOther] = useState("");
  const [answerState, setAnswerState] = useState<AnswerState>({ kind: "editing" });
  const sending = useRef(false);
  const blocked = answerState.kind === "sending" || answerState.kind === "settled";
  const answer = other.trim() === "" ? selected : other.trim();
  const canSubmit = answer !== undefined;

  const submit = async (): Promise<void> => {
    if (blocked || sending.current || answer === undefined) return;
    sending.current = true;
    setAnswerState({ kind: "sending" });

    try {
      const outcome = await onReply(answer);
      setAnswerState(outcome === undefined ? { kind: "failed" } : { kind: "settled", outcome });
    } catch {
      setAnswerState({ kind: "failed" });
    } finally {
      sending.current = false;
    }
  };

  return (
    <html.div style={styles.wrap}>
      <html.span style={textStyles.secondary}>Needs your answer</html.span>
      <html.div aria-labelledby={titleId} style={styles.card}>
        <html.h2 id={titleId} style={[textStyles.headline, styles.title]}>
          {question.prompt}
        </html.h2>
        <html.p style={textStyles.secondary}>Choose one answer.</html.p>
        <html.div
          role="radiogroup"
          aria-labelledby={titleId}
          aria-busy={answerState.kind === "sending"}
          style={styles.choices}
        >
          {question.options.map((choice, index) => {
            const chosen = selected === choice;

            return (
              <html.button
                key={choice}
                role="radio"
                aria-label={choice}
                aria-checked={chosen}
                disabled={blocked}
                onClick={() => {
                  if (blocked) return;
                  setSelected(choice);
                  setOther("");
                }}
                style={[
                  styles.choice,
                  index < question.options.length - 1 && styles.choiceSeparator,
                  blocked && styles.disabled,
                ]}
              >
                <SymbolView
                  name={chosen ? "checkmark.circle.fill" : "circle"}
                  size={22}
                  tintColor={chosen ? theme.accent : theme.interactiveTertiary}
                />
                <html.div style={styles.choiceText}>
                  <html.span style={textStyles.body}>{choice}</html.span>
                </html.div>
              </html.button>
            );
          })}
        </html.div>
        <TextInput
          accessibilityLabel="Answer in your own words"
          placeholder="Answer in your own words"
          placeholderTextColor={theme.muted}
          selectionColor={theme.accent}
          value={other}
          editable={!blocked}
          onChangeText={(text) => {
            setOther(text);

            if (text.trim() !== "") setSelected(undefined);
          }}
          returnKeyType="send"
          onSubmitEditing={() => {
            void submit();
          }}
          style={{
            ...typography.body,
            color: theme.foreground,
            backgroundColor: theme.raised,
            minHeight: controls.touchTarget,
            padding: spacing.md,
            borderRadius: radii.control,
          }}
        />
        <GlassButton
          label={answerState.kind === "sending" ? "Sending answer…" : "Send answer"}
          disabled={blocked || !canSubmit}
          prominent
          fill
          onPress={() => {
            void submit();
          }}
        />
        {answerState.kind === "settled" ? (
          <html.p role="status" style={textStyles.secondary}>
            {answerState.outcome.kind === "ok"
              ? "Answer sent."
              : "This question is no longer waiting for an answer."}
          </html.p>
        ) : answerState.kind === "failed" ? (
          <html.p role="alert" style={textStyles.error}>
            Couldn't send your answer. Try again.
          </html.p>
        ) : null}
      </html.div>
    </html.div>
  );
}

const styles = css.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    marginBlock: spacing.md,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: tokens.surface,
    borderWidth: controls.hairline,
    borderStyle: "solid",
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
  },
  title: { margin: 0 },
  choices: { display: "flex", flexDirection: "column" },
  choice: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: controls.touchTarget,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  choiceSeparator: {
    borderBottomWidth: controls.hairline,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.separator,
  },
  choiceText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  disabled: { opacity: controls.disabledOpacity },
});
