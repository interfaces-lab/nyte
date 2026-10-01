import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- the deadline timer follows the call's until
import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { SelectionReply, SessionId, SessionSnapshot } from "@nyte-ai/protocol";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Row } from "@nyte-ai/ui/row";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@nyte-ai/ui/questionnaire";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { checkbox, shape } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { nyte } from "../../nyte.ts";
import { loadThread } from "../../live.ts";
import { keys } from "../../queries.ts";
import { tray } from "../../theme/schema.stylex.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Tray, trayParts, useTrayRoot } from "./tray.tsx";
import {
  acceptsReply,
  childSelectionOptions,
  parkedSelections,
  pickedChoices,
  selectionReplyOptions,
} from "./questions-state.ts";
import type { ParkedSelection } from "./questions-state.ts";

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
    "--_row-fill": { default: "transparent", ":hover:not(:disabled)": role.bgHover },
    alignItems: "flex-start",
    gap: 8,
    minHeight: tray.rowHeight,
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: shape.control,
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

function useDeadline(until: number | undefined): number | undefined {
  const [value, setValue] = useState(() =>
    until === undefined ? undefined : Math.max(0, until - Date.now()),
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const update = (): void => {
      if (until === undefined) {
        setValue(undefined);

        return;
      }

      const remaining = Math.max(0, until - Date.now());
      setValue(remaining);

      if (remaining > 0) timer = setTimeout(update, Math.min(1_000, remaining));
    };

    timer = setTimeout(update, 0);

    return () => clearTimeout(timer);
  }, [until]);

  return value;
}

function deadlineLabel(remaining: number): string {
  const seconds = Math.max(0, Math.ceil(remaining / 1_000));

  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
}

/**
 * What a reply may have changed. These are not duplicates of the rebase
 * reconciliation in live.ts. A delegated child is answered through its
 * parent's card, so `sessionId` is the child while `threadSessionId` is the
 * parent whose children query feeds it, and nobody observes the child:
 * `loadThread` opens its observer, whose first read is a bootstrap and
 * reconciles nothing.
 */
async function refreshAnswered(
  queryClient: QueryClient,
  sessionId: SessionId,
  threadSessionId: SessionId,
): Promise<void> {
  await Promise.all([
    loadThread(sessionId),
    queryClient.invalidateQueries(
      { queryKey: keys.children(threadSessionId), exact: true },
      { throwOnError: true },
    ),
    // A reply may change a setting, as web search consent does.
    queryClient.invalidateQueries(
      { queryKey: keys.pluginSettings(sessionId), exact: true },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: ["customize", sessionId], exact: true },
      { throwOnError: true },
    ),
  ]);
}

function SelectionCard({
  sessionId,
  threadSessionId,
  model,
  call,
  disabled,
}: {
  readonly sessionId: SessionId;
  readonly threadSessionId: SessionId;
  readonly model?: string;
  readonly call: ParkedSelection;
  readonly disabled: boolean;
}): ReactElement {
  const id = useId();
  const queryClient = useQueryClient();

  const selected = useSyncExternalStore(pickedChoices.subscribe, () =>
    pickedChoices.get(call.waitId),
  );

  const remaining = useDeadline(call.until);
  const submitting = useRef(false);
  const { selection } = call;

  const refresh = useMutation({
    mutationFn: () => refreshAnswered(queryClient, sessionId, threadSessionId),
    retry: false,
  });

  const reply = useMutation(
    selectionReplyOptions({
      sessionId,
      call,
      reply: (input) => nyte.runs.reply(input),
      refresh: () => refresh.mutateAsync(),
    }),
  );

  const expired = remaining !== undefined && remaining <= 0;

  const blocked =
    expired ||
    disabled ||
    reply.isPending ||
    reply.isSuccess ||
    refresh.isPending ||
    refresh.isError;

  const send = (answer: SelectionReply) => {
    if (blocked || submitting.current) return;
    submitting.current = true;
    reply.mutate(answer, {
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  const toggle = (choiceId: string): void => {
    if (blocked) return;
    pickedChoices.set(
      call.waitId,
      selected.includes(choiceId)
        ? selected.filter((selectedId) => selectedId !== choiceId)
        : [...selected, choiceId],
    );
  };

  if (expired) return <></>;

  return (
    <Questionnaire
      aria-labelledby={`${id}-title`}
      item={call.waitId}
      items={[
        {
          name: call.waitId,
          required: true,
          choices: selection.choices.map((choice) => ({ value: choice.id, disabled: blocked })),
        },
      ]}
      onSubmit={(event) => {
        event.preventDefault();
        if (selection.multiple === true) send({ choices: selected });
      }}
      {...props(styles.card)}
    >
      <QuestionnaireItem
        name={call.waitId}
        multiple={selection.multiple === true}
        required
        aria-labelledby={`${id}-title`}
        {...props(trayParts.presence)}
      >
        <div {...props(styles.header)}>
          <QuestionnaireTitle render={<h2 />} id={`${id}-title`} {...props(styles.heading)}>
            {model !== undefined && <span {...props(styles.origin)}>Asked by {model}</span>}
            {selection.title}
          </QuestionnaireTitle>
          {remaining !== undefined && (
            <span {...props(styles.deadline)}>Closes in {deadlineLabel(remaining)}</span>
          )}
        </div>
        <QuestionnaireChoices
          role="group"
          aria-labelledby={`${id}-title`}
          aria-busy={reply.isPending}
          {...props(styles.choices)}
        >
          {selection.choices.map((choice, index) => {
            const checked = selected.includes(choice.id);
            const descriptionId = `${id}-choice-${String(index)}-description`;

            return (
              <Fragment key={choice.id}>
                <QuestionnaireChoice
                  hidden
                  value={choice.id}
                  checked={checked}
                  disabled={blocked}
                  onChange={() => {
                    if (selection.multiple === true) toggle(choice.id);
                    else send({ choices: [choice.id] });
                  }}
                >
                  {choice.label}
                </QuestionnaireChoice>
                <Row
                  variant="nav"
                  aria-label={choice.label}
                  aria-describedby={choice.description === undefined ? undefined : descriptionId}
                  aria-pressed={selection.multiple === true ? checked : undefined}
                  disabled={blocked}
                  xstyle={[styles.choice, focus.ring]}
                  onClick={(event) => {
                    const input =
                      event.currentTarget.previousElementSibling?.querySelector("input");
                    if (input instanceof HTMLInputElement) input.click();
                  }}
                >
                  {selection.multiple === true && (
                    <span
                      aria-hidden="true"
                      {...props(styles.box, checked && [intent.primary, styles.boxChecked])}
                    >
                      {checked && <Icon name="checkmark" size={12} />}
                    </span>
                  )}
                  <span {...props(styles.choiceText)}>
                    <span>{choice.label}</span>
                    {choice.description !== undefined && (
                      <QuestionnaireChoiceDescription
                        id={descriptionId}
                        {...props(styles.description)}
                      >
                        {choice.description}
                      </QuestionnaireChoiceDescription>
                    )}
                  </span>
                </Row>
              </Fragment>
            );
          })}
        </QuestionnaireChoices>
        {selection.multiple === true && (
          <QuestionnaireActions {...props(styles.footer)}>
            <QuestionnaireSubmit
              disabled={blocked || selected.length === 0}
              render={
                <Button
                  variant="solid"
                  tone="primary"
                  size="sm"
                  round
                  loading={reply.isPending}
                  disabled={blocked || selected.length === 0}
                >
                  Send Answer
                </Button>
              }
            >
              Send Answer
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        )}
        {reply.isPending && (
          <div role="status" {...props(styles.note)}>
            Sending answer…
          </div>
        )}
        {refresh.isPending && !reply.isPending && (
          <div role="status" {...props(styles.note)}>
            Refreshing…
          </div>
        )}
        {reply.isSuccess && (
          <div role="status" {...props(styles.note)}>
            {reply.data.kind === "signalled"
              ? "Answer sent."
              : "This is no longer waiting for an answer."}
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
        {refresh.isError && (
          <QuestionnaireError
            hidden={false}
            render={<div />}
            role="alert"
            {...props(intent.danger, styles.note, styles.error)}
          >
            Couldn&rsquo;t refresh this session.
            <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
              Refresh
            </Button>
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
 * The first waiting question that takes typed words, in the tray's order. The
 * composer answers it, as the terminal's does, together with anything checked
 * on its card.
 */
export function useComposerAnswer(
  sessionId: SessionId,
  parked: SessionSnapshot["parked"],
): ComposerAnswer | undefined {
  const queryClient = useQueryClient();
  const children = useQuery(childSelectionOptions(sessionId, nyte.sessions));

  const target = [
    ...parkedSelections(parked).map((call) => ({ owner: sessionId, call })),
    ...(children.data ?? []).flatMap((child) =>
      child.calls.map((call) => ({ owner: child.sessionId, call })),
    ),
  ].flatMap(({ owner, call }) =>
    call.selection.other === undefined ? [] : [{ owner, call, placeholder: call.selection.other }],
  )[0];

  if (target === undefined) return undefined;
  const { owner, call, placeholder } = target;

  return {
    placeholder,
    send: async (text) => {
      const choices = pickedChoices.get(call.waitId);

      if (!acceptsReply(call.selection, { choices, other: text })) {
        throw new Error("Choose one of the offered answers.");
      }

      const outcome = await nyte.runs.reply({
        sessionId: owner,
        runId: call.runId,
        callId: call.callId,
        waitId: call.waitId,
        reply: { choices: [...choices], other: text.trim() },
      });

      // The reply stands whether or not the refresh does; the watch catches up.
      await refreshAnswered(queryClient, owner, sessionId).catch(() => undefined);

      if (outcome.kind !== "signalled") throw new Error("This question is no longer waiting.");
    },
  };
}

/** Every question waiting on this session or on a session it delegated to. */
export function Questions({
  sessionId,
  parked,
  disabled,
}: {
  readonly sessionId: SessionId;
  readonly parked: SessionSnapshot["parked"];
  readonly disabled: boolean;
}): ReactElement {
  const children = useQuery(childSelectionOptions(sessionId, nyte.sessions));

  return (
    <>
      {parkedSelections(parked).map((call) => (
        <SelectionCard
          key={`${sessionId}:${call.waitId}`}
          sessionId={sessionId}
          threadSessionId={sessionId}
          call={call}
          disabled={disabled}
        />
      ))}
      {children.data?.flatMap((child) =>
        child.calls.map((call) => (
          <SelectionCard
            key={`${child.sessionId}:${call.waitId}`}
            sessionId={child.sessionId}
            threadSessionId={sessionId}
            model={child.model}
            call={call}
            disabled={disabled || children.isError}
          />
        )),
      )}
      {children.isError && (
        <div role="alert" {...props(intent.danger, styles.error)}>
          Couldn&rsquo;t load delegated sessions.
          <Button loading={children.isFetching} onClick={() => void children.refetch()}>
            Try Again
          </Button>
        </div>
      )}
    </>
  );
}

/** Questions wait above the composer, which answers them in the user's own words. */
export function QuestionTray({
  sessionId,
  parked,
  disabled,
  viewport,
}: {
  readonly sessionId: SessionId;
  readonly parked: SessionSnapshot["parked"];
  readonly disabled: boolean;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const { ref, availableHeight } = useTrayRoot(viewport);
  const children = useQuery(childSelectionOptions(sessionId, nyte.sessions));

  const count =
    parkedSelections(parked).length +
    (children.data ?? []).reduce((sum, child) => sum + child.calls.length, 0);

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={count > 0 || children.isError} label="Questions">
        <div
          data-nyte-scrollport
          {...props(trayStyles.list, styles.list, trayParts.listHeight(availableHeight))}
        >
          <Questions sessionId={sessionId} parked={parked} disabled={disabled} />
        </div>
      </Tray>
    </div>
  );
}
