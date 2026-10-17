import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import type { ActOutcome } from "@nyte-ai/sdk";
import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { TextInput } from "react-native";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import type { OpenQuestion } from "../view-helpers.ts";
import { controls, useTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";

type WaitingSelectionProps = {
  question: OpenQuestion;
  onReply: (answers: QuestionAnswers) => Promise<ActOutcome<unknown> | undefined>;
};

type AnswerState =
  | { kind: "editing" | "sending" | "sent" | "closed" }
  | { kind: "failed"; message: string };

type QuestionDraft = {
  choices: QuestionAnswers[number];
  custom: string;
};

export function WaitingSelection({ question, onReply }: WaitingSelectionProps): ReactElement {
  return <SelectionForm key={question.part} question={question} onReply={onReply} />;
}

function SelectionForm({ question, onReply }: WaitingSelectionProps): ReactElement {
  const theme = useTheme();
  const titleId = useId();
  const [index, setIndex] = useState(0);

  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    question.questions.map(() => ({ choices: [], custom: "" })),
  );

  const [answerState, setAnswerState] = useState<AnswerState>({ kind: "editing" });
  const sending = useRef(false);

  const blocked =
    answerState.kind === "sending" || answerState.kind === "sent" || answerState.kind === "closed";

  const item = question.questions[index];
  const draft = drafts[index];
  const last = index === question.questions.length - 1;

  const submit = async (): Promise<void> => {
    if (blocked || sending.current) return;
    sending.current = true;
    setAnswerState({ kind: "sending" });

    const answers = drafts.map((current, position) => {
      const custom = current.custom.trim();

      if (custom === "" || current.choices.includes(custom)) return current.choices;

      return question.questions[position].multiple ? [...current.choices, custom] : [custom];
    });

    try {
      const outcome = await onReply(answers);

      if (outcome === undefined) {
        setAnswerState({ kind: "failed", message: "Couldn't send your answers. Try again." });
      } else {
        switch (outcome.kind) {
          case "ok":
            setAnswerState({ kind: "sent" });
            break;
          case "rejected":
            setAnswerState({ kind: "failed", message: outcome.reason });
            break;
          case "failed":
            setAnswerState({ kind: "failed", message: outcome.message });
            break;
          case "no-owner":
            setAnswerState({
              kind: "failed",
              message: "Your Mac can't accept these answers right now. Try again.",
            });
            break;
          case "unknown-action":
            setAnswerState({
              kind: "failed",
              message:
                "Your Mac doesn't support answering this question. Update Nyte, then try again.",
            });
            break;
          case "closed":
            setAnswerState({ kind: "closed" });
            break;
          default: {
            const exhaustive: never = outcome;

            return exhaustive;
          }
        }
      }
    } catch {
      setAnswerState({ kind: "failed", message: "Couldn't send your answers. Try again." });
    }

    sending.current = false;
  };

  const advance = () => {
    if (blocked) return;

    if (last) {
      void submit();

      return;
    }

    setIndex(index + 1);
  };

  return (
    <html.div style={styles.wrap}>
      <html.div aria-labelledby={titleId} style={styles.card}>
        <html.div style={styles.header}>
          <html.span style={textStyles.secondary}>{item.header}</html.span>
          {question.questions.length > 1 && (
            <html.span style={textStyles.secondary}>
              {index + 1} of {question.questions.length}
            </html.span>
          )}
        </html.div>
        <html.h2 id={titleId} style={[textStyles.headline, styles.title]}>
          {item.question}
        </html.h2>
        {item.multiple && <html.p style={textStyles.secondary}>Choose any that apply.</html.p>}
        <html.div
          role={item.multiple ? "group" : "radiogroup"}
          aria-labelledby={titleId}
          aria-busy={answerState.kind === "sending"}
          style={styles.choices}
        >
          {item.options.map((option) => {
            const chosen = draft.choices.includes(option.label);

            return (
              <html.button
                key={option.label}
                role={item.multiple ? "checkbox" : "radio"}
                aria-label={option.label}
                aria-checked={chosen}
                disabled={blocked}
                onClick={() => {
                  if (blocked) return;

                  setDrafts((current) =>
                    current.map((value, position) => {
                      if (position !== index) return value;

                      if (!item.multiple) return { choices: [option.label], custom: "" };

                      return {
                        ...value,
                        choices: value.choices.includes(option.label)
                          ? value.choices.filter((choice) => choice !== option.label)
                          : [...value.choices, option.label],
                      };
                    }),
                  );
                }}
                style={[styles.choice, chosen && styles.selected, blocked && styles.disabled]}
              >
                <html.div style={styles.choiceText}>
                  <html.span style={textStyles.body}>{option.label}</html.span>
                  <html.span style={textStyles.secondary}>{option.description}</html.span>
                </html.div>
              </html.button>
            );
          })}
        </html.div>
        <TextInput
          accessibilityLabel={`Type your own answer for ${item.header}`}
          placeholder="Type your own answer"
          placeholderTextColor={theme.muted}
          selectionColor={theme.accent}
          value={draft.custom}
          editable={!blocked}
          onChangeText={(custom) => {
            setDrafts((current) =>
              current.map((value, position) =>
                position === index
                  ? {
                      choices: !item.multiple && custom.trim() !== "" ? [] : value.choices,
                      custom,
                    }
                  : value,
              ),
            );
          }}
          returnKeyType={last ? "send" : "next"}
          onSubmitEditing={advance}
          style={{
            ...typography.body,
            color: theme.foreground,
            backgroundColor: theme.raised,
            minHeight: controls.touchTarget,
            padding: spacing.md,
            borderRadius: radii.control,
          }}
        />
        <html.div style={styles.actions}>
          {question.questions.length > 1 && (
            <GlassButton
              label="Back"
              disabled={blocked || index === 0}
              onPress={() => setIndex(index - 1)}
            />
          )}
          <GlassButton
            label={answerState.kind === "sending" ? "Sending answers…" : last ? "Submit" : "Next"}
            disabled={blocked}
            prominent
            onPress={advance}
          />
        </html.div>
        {answerState.kind === "sent" ? (
          <html.p role="status" style={textStyles.secondary}>
            Answers sent.
          </html.p>
        ) : answerState.kind === "closed" ? (
          <html.p role="status" style={textStyles.secondary}>
            These questions are no longer waiting.
          </html.p>
        ) : answerState.kind === "failed" ? (
          <html.p role="alert" style={textStyles.error}>
            {answerState.message}
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
  header: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: { margin: 0 },
  choices: { display: "flex", flexDirection: "column", gap: spacing.sm },
  choice: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    minHeight: controls.touchTarget,
    padding: spacing.md,
    borderWidth: controls.borderWidth,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: radii.control,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  selected: { borderColor: tokens.accent },
  choiceText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  disabled: { opacity: controls.disabledOpacity },
});
