import type { WaitingCall } from "@nyte-ai/client";
import { acceptsSelectionReply, type ReplyOutcome, type SelectionReply } from "@nyte-ai/protocol";
import { SymbolView } from "expo-symbols";
// oxlint-disable-next-line no-restricted-imports -- the expiry timer follows the deadline prop
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { TextInput } from "react-native";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { controls, useTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";

type WaitingSelectionProps = {
  waiting: WaitingCall;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
};

type AnswerState =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "failed" }
  | { kind: "settled"; outcome: ReplyOutcome };

export function WaitingSelection({ waiting, onReply }: WaitingSelectionProps): ReactElement {
  return (
    <SelectionForm
      key={JSON.stringify([waiting.sessionId, waiting.runId, waiting.callId, waiting.waitId])}
      waiting={waiting}
      onReply={onReply}
    />
  );
}

function SelectionForm({ waiting, onReply }: WaitingSelectionProps): ReactElement {
  const theme = useTheme();
  const titleId = useId();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [other, setOther] = useState("");
  const [answerState, setAnswerState] = useState<AnswerState>({ kind: "editing" });
  const sending = useRef(false);
  const [now, setNow] = useState(Date.now);
  const { selection, until } = waiting;
  const expired = until !== undefined && until <= now;
  const multiple = selection.multiple === true;

  // One wake per deadline; the target time arrives as a prop.
  useEffect(() => {
    if (until === undefined || until <= now) return;
    // Long-lived waits exceed the timer's signed 32-bit delay; recheck on each wake.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(0, until - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [now, until]);

  const blocked = expired || answerState.kind === "sending" || answerState.kind === "settled";
  const answer: SelectionReply = {
    choices: selected,
    ...(other.trim() === "" ? {} : { other: other.trim() }),
  };
  const canSubmit = acceptsSelectionReply(selection, answer);
  const submit = async (): Promise<void> => {
    if (blocked || sending.current || !canSubmit) return;
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
          {selection.title}
        </html.h2>
        <html.p style={textStyles.secondary}>
          {multiple ? "Choose one or more answers." : "Choose one answer."}
        </html.p>
        <html.div
          role={multiple ? "group" : "radiogroup"}
          aria-labelledby={titleId}
          aria-busy={answerState.kind === "sending"}
          style={styles.choices}
        >
          {selection.choices.map((choice, index) => {
            const chosen = selected.includes(choice.id);
            return (
              <html.button
                key={choice.id}
                role={multiple ? "checkbox" : "radio"}
                aria-label={
                  choice.description === undefined
                    ? choice.label
                    : `${choice.label}. ${choice.description}`
                }
                aria-checked={chosen}
                disabled={blocked}
                onClick={() => {
                  if (blocked) return;
                  setSelected((current) =>
                    multiple
                      ? current.includes(choice.id)
                        ? current.filter((id) => id !== choice.id)
                        : [...current, choice.id]
                      : [choice.id],
                  );
                  if (!multiple) setOther("");
                }}
                style={[
                  styles.choice,
                  index < selection.choices.length - 1 && styles.choiceSeparator,
                  blocked && styles.disabled,
                ]}
              >
                <SymbolView
                  name={chosen ? "checkmark.circle.fill" : "circle"}
                  size={22}
                  tintColor={chosen ? theme.accent : theme.tertiary}
                />
                <html.div style={styles.choiceText}>
                  <html.span style={textStyles.body}>{choice.label}</html.span>
                  {choice.description === undefined ? null : (
                    <html.span style={textStyles.secondary}>{choice.description}</html.span>
                  )}
                </html.div>
              </html.button>
            );
          })}
        </html.div>
        {selection.other === undefined ? null : (
          <TextInput
            accessibilityLabel={selection.other}
            placeholder={selection.other}
            placeholderTextColor={theme.muted}
            selectionColor={theme.accent}
            value={other}
            editable={!blocked}
            onChangeText={(text) => {
              setOther(text);
              if (!multiple && text.trim() !== "") setSelected([]);
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
        )}
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
            {answerState.outcome.kind === "signalled"
              ? "Answer sent."
              : "This question is no longer waiting for an answer."}
          </html.p>
        ) : expired ? (
          <html.p role="status" style={textStyles.secondary}>
            This question has expired.
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
