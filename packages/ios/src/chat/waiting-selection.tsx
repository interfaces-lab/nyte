import type { WaitingCall } from "@nyte-ai/core/client";
import { acceptsSelectionReply, type ReplyOutcome, type SelectionReply } from "@nyte-ai/protocol";
import { SymbolView } from "expo-symbols";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { TextInput } from "react-native";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { controls, nativeTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";

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
  const titleId = useId();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [other, setOther] = useState("");
  const [answerState, setAnswerState] = useState<AnswerState>({ kind: "editing" });
  const sending = useRef(false);
  const [now, setNow] = useState(Date.now);
  const { selection, until } = waiting;
  const expired = until !== undefined && until <= now;

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
    <html.div aria-labelledby={titleId} style={styles.card}>
      <html.div style={styles.heading}>
        <SymbolView
          name="questionmark.circle"
          size={controls.icon}
          tintColor={nativeTheme.accent}
        />
        <html.span style={[textStyles.label, styles.accent]}>Question</html.span>
      </html.div>
      <html.h2 id={titleId} style={[textStyles.title, styles.title]}>
        {selection.title}
      </html.h2>
      <html.p style={[textStyles.secondary]}>
        {selection.multiple === true ? "Choose one or more answers." : "Choose one answer."}
      </html.p>
      <html.div
        role={selection.multiple === true ? "group" : "radiogroup"}
        aria-labelledby={titleId}
        aria-busy={answerState.kind === "sending"}
        style={styles.choices}
      >
        {selection.choices.map((choice) => {
          const chosen = selected.includes(choice.id);
          return (
            <html.button
              key={choice.id}
              role={selection.multiple === true ? "checkbox" : "radio"}
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
                  selection.multiple === true
                    ? current.includes(choice.id)
                      ? current.filter((id) => id !== choice.id)
                      : [...current, choice.id]
                    : [choice.id],
                );
                if (selection.multiple !== true) setOther("");
              }}
              style={[
                styles.choice,
                chosen ? styles.chosen : null,
                blocked ? styles.disabled : null,
              ]}
            >
              <SymbolView
                name={
                  selection.multiple === true
                    ? chosen
                      ? "checkmark.square.fill"
                      : "square"
                    : chosen
                      ? "largecircle.fill.circle"
                      : "circle"
                }
                size={controls.icon}
                tintColor={chosen ? nativeTheme.accent : nativeTheme.muted}
              />
              <html.div style={styles.choiceText}>
                <html.span style={[textStyles.body]}>{choice.label}</html.span>
                {choice.description === undefined ? null : (
                  <html.span style={[textStyles.secondary]}>{choice.description}</html.span>
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
          placeholderTextColor={nativeTheme.muted}
          selectionColor={nativeTheme.accent}
          value={other}
          editable={!blocked}
          onChangeText={(text) => {
            setOther(text);
            if (selection.multiple !== true && text.trim() !== "") setSelected([]);
          }}
          returnKeyType="send"
          onSubmitEditing={() => {
            void submit();
          }}
          style={{
            ...typography.body,
            color: nativeTheme.foreground,
            backgroundColor: nativeTheme.raised,
            minHeight: controls.touchTarget,
            padding: spacing.md,
            borderRadius: radii.control,
          }}
        />
      )}
      <GlassButton
        label={answerState.kind === "sending" ? "Sending answer…" : "Send answer"}
        disabled={blocked || !canSubmit}
        onPress={() => {
          void submit();
        }}
        prominent
        fullWidth
      />
      {answerState.kind === "settled" ? (
        <html.p role="status" style={[textStyles.secondary]}>
          {answerState.outcome.kind === "signalled"
            ? "Answer sent."
            : "This question is no longer waiting for an answer."}
        </html.p>
      ) : expired ? (
        <html.p role="status" style={[textStyles.secondary]}>
          This question has expired.
        </html.p>
      ) : answerState.kind === "failed" ? (
        <html.p role="alert" style={[textStyles.error]}>
          Couldn't send your answer. Try again.
        </html.p>
      ) : null}
    </html.div>
  );
}

const styles = css.create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    padding: spacing.lg,
    marginInline: spacing.lg,
    marginBlock: spacing.md,
    borderRadius: radii.card,
    backgroundColor: tokens.surface,
  },
  heading: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { margin: 0 },
  choices: { display: "flex", flexDirection: "column", gap: spacing.sm },
  choice: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: controls.touchTarget,
    padding: spacing.md,
    borderWidth: 0,
    borderRadius: radii.control,
    backgroundColor: { default: tokens.background, ":active": tokens.raised },
  },
  chosen: { backgroundColor: tokens.raised },
  choiceText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  disabled: { opacity: controls.disabledOpacity },
  accent: { color: tokens.accent },
});
