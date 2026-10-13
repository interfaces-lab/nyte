import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { Fragment, useId, useRef } from "react";
import type { ReactElement } from "react";
import { openQuestions } from "@nyte-ai/plugin/question";
import type { OpenQuestion } from "@nyte-ai/plugin/question";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { Row } from "@nyte-ai/ui/row";
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@nyte-ai/ui/questionnaire";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { checkbox, radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useChildSessions, useSessionView } from "../../queries.ts";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Tray, trayParts, useTrayRoot } from "./tray.tsx";
import { answerQuestion, questionAnswerOptions } from "./questions-state.ts";

const styles = create({
  list: { gap: 12, paddingTop: 6, paddingBottom: 6 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
    fontSize: type.fontBase,
    color: role.contentPrimary,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    paddingTop: 4,
    paddingBottom: 4,
    paddingInline: 6,
  },
  heading: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontSize: type.fontBase,
    fontWeight: 600,
    lineHeight: type.leadingBase,
    textWrap: "pretty",
  },
  origin: {
    display: "block",
    fontWeight: 400,
    color: role.contentSecondary,
    overflowWrap: "anywhere",
  },
  deadline: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
  },
  choices: { display: "flex", flexDirection: "column", gap: 1 },
  choice: {
    "--_row-fill": {
      default: "transparent",
      ":hover:not(:disabled)": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
    },
    alignItems: "flex-start",
    gap: 8,
    minHeight: tray.rowHeight,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: radius.control,
    lineHeight: type.leadingBase,
    color: { default: role.contentPrimary, ":disabled": role.contentDisabled },
  },
  choiceText: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  description: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  box: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: checkbox.sizeMd,
    height: checkbox.sizeMd,
    marginTop: 1,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: role.borderControlTranslucent,
    borderRadius: checkbox.radius,
  },
  // A ticked box paints inside the primary intent, as the checkbox does.
  boxChecked: {
    borderColor: role.bgControlSelected,
    backgroundColor: role.bgControlSelected,
    color: role.contentOnControl,
  },
  footer: { display: "flex", justifyContent: "flex-end", paddingInline: 6, paddingBottom: 6 },
  note: { paddingInline: 6, color: role.contentSecondary, fontSize: type.fontSm },
  error: { color: role.contentSecondary, fontSize: type.fontSm },
});

function QuestionCard({
  sessionId,
  origin,
  question,
  disabled,
}: {
  readonly sessionId: SessionId;
  readonly origin?: string;
  readonly question: OpenQuestion;
  readonly disabled: boolean;
}): ReactElement {
  const id = useId();
  const submitting = useRef(false);
  const reply = useMutation(questionAnswerOptions({ sessionId, question }));
  const blocked = disabled || reply.isPending || reply.isSuccess;

  const send = (choice: string) => {
    if (blocked || submitting.current) return;
    submitting.current = true;
    reply.mutate(choice, {
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  return (
    <Questionnaire
      aria-labelledby={`${id}-title`}
      item={question.part}
      items={[
        {
          name: question.part,
          required: true,
          choices: question.options.map((option) => ({ value: option, disabled: blocked })),
        },
      ]}
      onSubmit={(event) => event.preventDefault()}
      {...props(styles.card)}
    >
      <QuestionnaireItem
        name={question.part}
        multiple={false}
        required
        aria-labelledby={`${id}-title`}
        {...props(trayParts.presence)}
      >
        <div {...props(styles.header)}>
          <QuestionnaireTitle render={<h2 />} id={`${id}-title`} {...props(styles.heading)}>
            {origin !== undefined && <span {...props(styles.origin)}>Asked by {origin}</span>}
            {question.prompt}
          </QuestionnaireTitle>
        </div>
        <QuestionnaireChoices
          role="group"
          aria-labelledby={`${id}-title`}
          aria-busy={reply.isPending}
          {...props(styles.choices)}
        >
          {question.options.map((option) => (
            <Fragment key={option}>
              <QuestionnaireChoice
                hidden
                value={option}
                checked={false}
                disabled={blocked}
                onChange={() => send(option)}
              >
                {option}
              </QuestionnaireChoice>
              <Row
                variant="nav"
                aria-label={option}
                disabled={blocked}
                xstyle={[styles.choice, focus.ring]}
                onClick={(event) => {
                  const input = event.currentTarget.previousElementSibling?.querySelector("input");

                  if (input instanceof HTMLInputElement) input.click();
                }}
              >
                <span {...props(styles.choiceText)}>
                  <span>{option}</span>
                </span>
              </Row>
            </Fragment>
          ))}
        </QuestionnaireChoices>
        {reply.isPending && (
          <div role="status" {...props(styles.note)}>
            Sending answer…
          </div>
        )}
        {reply.isSuccess && (
          <div role="status" {...props(styles.note)}>
            Answer sent.
          </div>
        )}
        {reply.isError && (
          <QuestionnaireError
            hidden={false}
            render={<div />}
            role="alert"
            {...props(intent.danger, styles.note, styles.error)}
          >
            Couldn&rsquo;t send your answer. Try again.
          </QuestionnaireError>
        )}
      </QuestionnaireItem>
    </Questionnaire>
  );
}

/** What the composer answers while a question waits, with the words it asks for. */
export interface ComposerAnswer {
  readonly placeholder: string;
  readonly send: (text: string) => Promise<void>;
}

/**
 * The first waiting question of this session, in the tray's order. The
 * composer answers it in the user's own words, as the terminal's does.
 */
export function useComposerAnswer(sessionId: SessionId): ComposerAnswer | undefined {
  const [question] = openQuestions(useSessionView(sessionId));

  if (question === undefined) return undefined;

  return {
    placeholder: "Answer in your own words",
    send: (text) => answerQuestion(sessionId, question, text),
  };
}

/** A delegated child's waiting questions, watched while the child waits on one. */
function ChildQuestions({
  child,
  disabled,
}: {
  readonly child: SessionInfo;
  readonly disabled: boolean;
}): ReactElement {
  const questions = openQuestions(useSessionView(child.id));

  return (
    <>
      {questions.map((question) => (
        <QuestionCard
          key={`${child.id}:${question.part}`}
          sessionId={child.id}
          origin={child.name ?? "a subagent"}
          question={question}
          disabled={disabled}
        />
      ))}
    </>
  );
}

/** Whether a child's main head is parked on a part, which is how a question waits. */
function waitsOnQuestion(child: SessionInfo): boolean {
  const execution = child.heads[0]?.execution;

  return execution?.kind === "waiting" && execution.on.kind === "part";
}

/** Every question waiting on this session or on a session it delegated to. */
export function Questions({
  sessionId,
  disabled,
}: {
  readonly sessionId: SessionId;
  readonly disabled: boolean;
}): ReactElement {
  const questions = openQuestions(useSessionView(sessionId));
  const children = useChildSessions(sessionId);

  return (
    <>
      {questions.map((question) => (
        <QuestionCard
          key={`${sessionId}:${question.part}`}
          sessionId={sessionId}
          question={question}
          disabled={disabled}
        />
      ))}
      {(children.data ?? []).filter(waitsOnQuestion).map((child) => (
        <ChildQuestions key={child.id} child={child} disabled={disabled} />
      ))}
    </>
  );
}

/** Questions wait above the composer, which answers them in the user's own words. */
export function QuestionTray({
  sessionId,
  disabled,
  viewport,
}: {
  readonly sessionId: SessionId;
  readonly disabled: boolean;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const { ref, availableHeight } = useTrayRoot(viewport);
  const children = useChildSessions(sessionId);
  const count =
    openQuestions(useSessionView(sessionId)).length +
    (children.data ?? []).filter(waitsOnQuestion).length;

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={count > 0} label="Questions">
        <div
          data-nyte-scrollport
          {...props(trayStyles.list, styles.list, trayParts.listHeight(availableHeight))}
        >
          <Questions sessionId={sessionId} disabled={disabled} />
        </div>
      </Tray>
    </div>
  );
}
