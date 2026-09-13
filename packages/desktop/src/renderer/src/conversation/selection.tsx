import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SelectionReply, SessionId, SessionSnapshot } from "@nyte-ai/core";
import { Button, focus } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { loadThread } from "../live.ts";
import { keys } from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
import { childSelectionOptions, parkedSelections, selectionReplyOptions } from "./selection.ts";
import type { ParkedSelection } from "./selection.ts";

const styles = create({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    padding: 10,
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    backgroundColor: t.bgEditor,
    fontSize: t.fontBase,
    color: t.textPrimary,
  },
  heading: { margin: 0, fontSize: t.fontBase, fontWeight: 600, textWrap: "balance" },
  origin: { margin: 0, overflowWrap: "anywhere", color: t.textTertiary },
  choices: { display: "flex", flexDirection: "column", gap: 2 },
  choice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    minHeight: 28,
    paddingBlock: 4,
    paddingInline: 6,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    textAlign: "start",
    font: "inherit",
    lineHeight: t.leadingBase,
    color: t.textSecondary,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": t.fillSecondary },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { ":disabled": 0.5 },
    transitionProperty: "background-color, color, opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  choiceSelected: {
    color: t.textPrimary,
    backgroundColor: { default: t.bgCard, ":hover:not(:disabled)": t.fillGhostHover },
  },
  choiceLine: { display: "flex", alignItems: "center", gap: 6 },
  choiceIndicator: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokePrimary,
    borderRadius: t.radiusXs,
    color: t.textPrimary,
    fontSize: t.fontXs,
    lineHeight: "14px",
  },
  choiceIndicatorSelected: { borderColor: t.strokeSecondary, backgroundColor: t.fillGhostSelected },
  description: {
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  ownAnswer: { display: "flex", alignItems: "center", gap: 6 },
  deadline: { color: t.textTertiary, fontSize: t.fontSm, fontVariantNumeric: "tabular-nums" },
  input: {
    flex: 1,
    minWidth: 0,
    height: 28,
    paddingInline: 8,
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    backgroundColor: t.fillSecondary,
    color: { default: t.textPrimary, "::placeholder": t.textTertiary },
    font: "inherit",
    outline: "none",
  },
  error: { color: t.textDanger, fontSize: t.fontSm },
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
  const [ownAnswer, setOwnAnswer] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const remaining = useDeadline(call.until);
  const submitting = useRef(false);
  const { selection } = call;
  const refresh = useMutation({
    mutationFn: async () => {
      // These are not duplicates of the rebase reconciliation in live.ts. A
      // delegated child is answered through its parent's card, so `sessionId`
      // is the child while `threadSessionId` is the parent whose children
      // query feeds it, and nobody observes the child: `loadThread` opens its
      // observer, whose first read is a bootstrap and reconciles nothing.
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
    },
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
    setSelected((current) =>
      current.includes(choiceId)
        ? current.filter((selectedId) => selectedId !== choiceId)
        : [...current, choiceId],
    );
  };
  const custom = ownAnswer.trim();
  const canSubmit = selected.length > 0 || custom !== "";
  if (expired) return <></>;

  return (
    <section aria-labelledby={`${id}-title`} {...props(styles.card)}>
      {model !== undefined && <p {...props(styles.origin)}>Asked by {model}</p>}
      <h2 id={`${id}-title`} {...props(styles.heading)}>
        {selection.title}
      </h2>
      {remaining !== undefined && (
        <div {...props(styles.deadline)}>Closes in {deadlineLabel(remaining)}</div>
      )}
      <div
        role="group"
        aria-labelledby={`${id}-title`}
        aria-busy={reply.isPending}
        {...props(styles.choices)}
      >
        {selection.choices.map((choice, index) => {
          const selectedChoice = selected.includes(choice.id);
          const descriptionId = `${id}-choice-${String(index)}-description`;
          return (
            <button
              key={choice.id}
              type="button"
              aria-label={choice.label}
              aria-describedby={choice.description === undefined ? undefined : descriptionId}
              aria-pressed={selection.multiple === true ? selectedChoice : undefined}
              disabled={blocked}
              {...props(
                styles.choice,
                selection.multiple === true && selectedChoice && styles.choiceSelected,
                focus.ring,
              )}
              onClick={() => {
                if (selection.multiple === true) toggle(choice.id);
                else send({ choices: [choice.id] });
              }}
            >
              {selection.multiple === true ? (
                <span {...props(styles.choiceLine)}>
                  <span
                    aria-hidden="true"
                    {...props(
                      styles.choiceIndicator,
                      selectedChoice && styles.choiceIndicatorSelected,
                    )}
                  >
                    {selectedChoice ? "✓" : ""}
                  </span>
                  <span>{choice.label}</span>
                </span>
              ) : (
                <span>{choice.label}</span>
              )}
              {choice.description !== undefined && (
                <span id={descriptionId} {...props(styles.description)}>
                  {choice.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {(selection.multiple === true || selection.other !== undefined) && (
        <form
          {...props(styles.ownAnswer)}
          onSubmit={(event) => {
            event.preventDefault();
            send({
              choices: selected,
              ...(custom === "" ? {} : { other: custom }),
            });
          }}
        >
          {selection.other !== undefined && (
            <input
              aria-label={selection.other}
              placeholder={selection.other}
              disabled={blocked}
              value={ownAnswer}
              onChange={(event) => setOwnAnswer(event.target.value)}
              {...props(styles.input, focus.ring)}
            />
          )}
          <Button type="submit" disabled={blocked || !canSubmit}>
            Answer
          </Button>
        </form>
      )}
      {reply.isPending && <div role="status">Sending answer…</div>}
      {refresh.isPending && !reply.isPending && <div role="status">Refreshing…</div>}
      {reply.isSuccess && (
        <div role="status">
          {reply.data.kind === "signalled"
            ? "Answer sent."
            : "This is no longer waiting for an answer."}
        </div>
      )}
      {reply.isError && (
        <div role="alert" {...props(styles.error)}>
          Couldn&rsquo;t send your answer. Try again.
        </div>
      )}
      {refresh.isError && (
        <div role="alert" {...props(styles.error)}>
          Couldn&rsquo;t refresh this session.
          <Button variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            Refresh
          </Button>
        </div>
      )}
    </section>
  );
}

/** Every selection waiting on this session or on a session it delegated to. */
export function Selections({
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
        <div role="alert" {...props(styles.error)}>
          Couldn&rsquo;t load delegated sessions.
          <Button
            variant="ghost"
            disabled={children.isFetching}
            onClick={() => void children.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
    </>
  );
}
