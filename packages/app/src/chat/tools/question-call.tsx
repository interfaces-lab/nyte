import { create, props } from "@stylexjs/stylex";
import { Fragment } from "react";
import type { ReactElement } from "react";
import { findQuestionPart, readQuestion } from "@nyte-ai/plugin/question/schema";
import type { QuestionPhase } from "@nyte-ai/plugin/question/schema";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import type { ToolClass } from "@nyte-ai/sdk";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { sessionWatch } from "../../data/watches.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { useTranscriptScope } from "../transcript/transcript.tsx";
import { ToolLineView } from "./tool-line.tsx";

const styles = create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    marginBlock: space.s0_5,
    paddingBlockStart: space.s3,
    paddingBlockEnd: space.s2_5,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    userSelect: "text",
  },
  divider: { height: 1, flexShrink: 0, backgroundColor: role.borderSecondaryTranslucent },
  pair: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, margin: 0 },
  question: {
    margin: 0,
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
    overflowWrap: "anywhere",
  },
  answer: {
    display: "-webkit-box",
    margin: 0,
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    color: role.contentPrimary,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  missing: { margin: 0, color: role.contentSecondary, fontStyle: "italic" },
  note: { color: role.contentTertiary },
});

/**
 * A question call where it was asked: each question over its answer, read from the request part
 * the call made. A request the agent stopped waiting on stays marked as waiting until the answer
 * arrives, then shows it as answered late; a run that ended first leaves it not answered.
 */
export function QuestionCallView({
  message,
  toolClass,
  cwd,
}: {
  readonly message: ToolMessage;
  readonly toolClass: Extract<ToolClass, { readonly kind: "custom" }>;
  readonly cwd: string | undefined;
}): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const call = message.state.call;

  const part = useWatchSelect(
    sessionId === undefined ? undefined : sessionWatch(sessionId),
    (state) => findQuestionPart(state.value?.parts ?? [], call),
  );

  const asked = part === undefined ? null : readQuestion(part);

  if (part === undefined || asked === null)
    return <ToolLineView message={message} toolClass={toolClass} cwd={cwd} />;

  const phase = asked.phase;
  const ended = part.status.kind === "failed";

  return (
    <div role="group" aria-label="Questions" {...props(text.base, styles.card)}>
      {asked.questions.map((item, index) => {
        const answer = phase.kind === "answered" ? (phase.answers[index] ?? []) : [];

        return (
          <Fragment key={index}>
            {index > 0 && <div role="separator" {...props(styles.divider)} />}
            <dl {...props(styles.pair)}>
              <dt {...props(styles.question)}>{item.question}</dt>
              {answer.length > 0 ? (
                <dd {...props(styles.answer)}>{answer.join(", ")}</dd>
              ) : (
                <dd {...props(styles.missing)}>{missingAnswer(phase, ended)}</dd>
              )}
            </dl>
          </Fragment>
        );
      })}
      {phase.kind === "answered" && phase.head !== null && (
        <span {...props(text.sm, styles.note)}>Answered after the agent moved on</span>
      )}
    </div>
  );
}

function missingAnswer(phase: QuestionPhase, ended: boolean): string {
  switch (phase.kind) {
    case "asking":
    case "open":
      return ended ? "Not answered" : "Waiting for your answer";
    case "answered":
      return "Unanswered";
    case "skipped":
      return "Skipped";
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}
