import { intent } from "@nyte-ai/ui/surface-theme";
import { glyph } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { useState, type ReactNode } from "react";
import { C } from "./ui";

interface Question {
  readonly prompt: ReactNode;
  readonly choices: readonly ReactNode[];
  readonly answer: number;
  readonly why: ReactNode;
}

const QUESTIONS: readonly Question[] = [
  {
    prompt: (
      <>
        <C>messages.send</C> returns <C>{'{ kind: "queued" }'}</C> for an idle head. What has been
        published?
      </>
    ),
    choices: [
      <>
        A <C>Change</C> at <C>refs/inbox/main/next/tip</C>
      </>,
      <>
        A user commit at <C>refs/heads/main</C>
      </>,
      <>
        A <C>Run</C> at <C>refs/runs/main</C>
      </>,
      "Only an event",
    ],
    answer: 0,
    why: <>Submit moves only the inbox tip. The commit and the run appear later, in land.</>,
  },
  {
    prompt: "Where does an idle runner wait for work?",
    choices: [
      <>
        A <C>setInterval</C> polling the run ref
      </>,
      <C key="3">waitForHead</C>,
      <>
        The <C>for (;;)</C> in <C>drive</C>
      </>,
      <>
        The <C>for await</C> over <C>session.events.watch</C> in <C>loop()</C>
      </>,
    ],
    answer: 3,
    why: <>drive returns once the head rests. The store wakes the watch after every ref commit.</>,
  },
  {
    prompt: (
      <>
        A run is in <C>respond</C>. A message arrives with delivery <C>"next"</C>. When does it
        land?
      </>
    ),
    choices: [
      "At once, joining the run",
      <>
        After the run is terminal, through <C>landOrIdle</C>
      </>,
      <>
        At the next <C>respond</C> boundary
      </>,
      <>
        Never. <C>next</C> is for idle sessions only
      </>,
    ],
    answer: 1,
    why: (
      <>
        The respond boundary lands only <C>steer</C>. <C>landOrIdle</C> runs only with no run or a
        terminal one, and it tries <C>steer</C> before <C>next</C>.
      </>
    ),
  },
  {
    prompt: (
      <>
        Same run, delivery <C>"steer"</C>, same agent. What does <C>decide</C> return at the
        boundary?
      </>
    ),
    choices: [
      <C key="0">wait</C>,
      <C key="2">handoff</C>,
      <C key="1">join</C>,
      <C key="3">start</C>,
    ],
    answer: 2,
    why: (
      <>
        Live and user is <C>join</C>. With a different agent it is <C>handoff</C>, which ends the
        run <C>done</C> so the next pass starts a new one.
      </>
    ),
  },
  {
    prompt: (
      <>
        <C>drive</C> returns <C>finished</C>. What makes the runner step again to land a queued
        message?
      </>
    ),
    choices: [
      <>
        Its own run-ref events marked the head dirty, so <C>wake</C> drives again
      </>,
      <>
        <C>drive</C> loops on <C>finished</C>
      </>,
      "A 1 s timer",
      <>
        The client calls <C>nyte.advance</C>
      </>,
    ],
    answer: 0,
    why: (
      <>
        <C>handleRef</C> sees <C>refs/runs/main</C> move during the drive and calls <C>wake</C>,
        which only sets <C>dirty</C>. The running pass sees it when the drive returns.
      </>
    ),
  },
  {
    prompt:
      "Host A's head lease expires mid-stream. Host B takes it over. A finishes and publishes. What happens?",
    choices: [
      <>
        <C>ok</C>, last writer wins
      </>,
      <C key="1">conflict</C>,
      "A's write merges with B's",
      <C key="2">fenced</C>,
    ],
    answer: 3,
    why: (
      <>
        B holds the raised fence. <C>refs.update</C> checks the lease before any <C>from</C>, so A
        gets <C>fenced</C> and writes nothing.
      </>
    ),
  },
  {
    prompt: (
      <>
        Why does every runner publish carry{" "}
        <C>{'{ name: "refs/deleted", from: null, to: null }'}</C>?
      </>
    ),
    choices: [
      "It clears a stale delete",
      "It bumps the event seq",
      "It asserts the session is not being deleted",
      "It releases the lease",
    ],
    answer: 2,
    why: (
      <>
        <C>to === from</C> is an assertion. Once <C>sessions.delete</C> writes <C>refs/deleted</C>,
        every runner publish conflicts.
      </>
    ),
  },
  {
    prompt: (
      <>
        The head is idle. A model change, a passive config, is queued with no user message. What
        does <C>decide</C> return?
      </>
    ),
    choices: [
      <C key="0">wait</C>,
      <C key="2">settle</C>,
      <C key="1">start</C>,
      <C key="3">join</C>,
    ],
    answer: 1,
    why: (
      <>
        Idle and passive is <C>settle</C>. The config commit lands under the last run's id and no
        response is requested.
      </>
    ),
  },
  {
    prompt: (
      <>
        A tool without <C>replay</C> crashes between intent and result. The next step finds the
        intent. What happens?
      </>
    ),
    choices: [
      "It runs again",
      "The stored result is reused",
      "The run parks",
      "The call settles with an interrupted error",
    ],
    answer: 3,
    why: (
      <>
        <C>replay</C> defaults to <C>"never"</C>, and <C>decideRecovery</C> answers{" "}
        <C>interrupted</C>. Only <C>"safe"</C> runs again.
      </>
    ),
  },
  {
    prompt: (
      <>
        A <C>"safe"</C> tool crashes between intent and result. The session reopens on a host whose
        environment has a different <C>id</C>. What happens?
      </>
    ),
    choices: [
      "The call settles with an interrupted error",
      "It runs again on the new host",
      "The run parks until the old host returns",
      "The run fails",
    ],
    answer: 0,
    why: (
      <>
        The intent recorded the environment <C>id</C> it opened in. <C>decideRecovery</C> compares
        it with the resuming runner's, and a mismatch answers <C>interrupted</C>.
      </>
    ),
  },
  {
    prompt: (
      <>
        A plugin tool parks with <C>throw new ToolWait({"{}"})</C>. What happens?
      </>
    ),
    choices: [
      "It parks until the runner wakes it",
      "It expires after 30 s",
      "It does not type-check",
      "It becomes a background wait",
    ],
    answer: 2,
    why: (
      <>
        <C>ToolWaitOptions</C> needs a <C>selection</C>, an <C>until</C>, or both, so every parked
        call can end. Only the kernel's <C>backgroundWait</C> parks with neither.
      </>
    ),
  },
  {
    prompt: (
      <>
        A plugin's <C>before_tool</C> hook never settles. What happens to the call?
      </>
    ),
    choices: [
      "The run waits for the hook",
      "After 5 s the call settles as an error",
      "After 5 s the call runs without the policy",
      "The plugin is unloaded",
    ],
    answer: 1,
    why: (
      <>
        The hook's 5 s budget runs out and the handler counts as thrown. A thrown <C>before_tool</C>{" "}
        becomes <C>error</C>, which blocks this call and the rest of its batch with the policy's
        message as an error result.
      </>
    ),
  },
  {
    prompt: (
      <>
        A run fails with <C>rate_limit</C> while <C>phase.retries</C> is already 3. What is the next
        phase?
      </>
    ),
    choices: [
      <>
        <C>retry</C> with an 8 s delay
      </>,
      <>
        <C>retry</C> with a 4 s delay
      </>,
      <C key="3">aborted</C>,
      <C key="2">failed</C>,
    ],
    answer: 3,
    why: <>maxRetries is 3. The three retries waited 1 s, 2 s and 4 s.</>,
  },
  {
    prompt: (
      <>
        A stop arrives during a retry backoff. What does <C>advance</C> do?
      </>
    ),
    choices: [
      <>
        Calls <C>respond</C> at once, which ends the run <C>aborted</C>
      </>,
      <>
        Waits out <C>phase.at</C>, then aborts
      </>,
      "Deletes the run ref",
      "Nothing until the lease expires",
    ],
    answer: 0,
    why: (
      <>
        The stop cuts <C>drive</C>'s sleep. The next <C>advance</C> sees <C>abortRequested</C> and
        calls <C>respond</C>, which ends the run <C>aborted</C>.
      </>
    ),
  },
  {
    prompt: (
      <>
        The run is flagged <C>abortRequested</C>, and <C>turn.respond</C> returns <C>failed</C>.
        What phase is published?
      </>
    ),
    choices: [
      <C key="0">failed</C>,
      <C key="2">done</C>,
      <>
        <C>aborted</C>, with the failure as a notice
      </>,
      <C key="3">retry</C>,
    ],
    answer: 2,
    why: (
      <>
        The flag moved <C>refs/runs</C>, so the respond publish conflicts. <C>afterConflict</C>{" "}
        stores <C>aborted</C>, and <C>noteOverriddenFailure</C> appends the failure as a notice.
      </>
    ),
  },
  {
    prompt: (
      <>
        <C>contextWindow</C> is 200_000, the context is 190_000 tokens, settings are default. Does
        the step checkpoint before it calls <C>turn.respond</C>?
      </>
    ),
    choices: [
      "No",
      "Yes, 190_000 > 183_616",
      "Only after an overflow error",
      <>
        Only past <C>keepRecentTokens</C>
      </>,
    ],
    answer: 1,
    why: (
      <>
        <C>turn.prepare</C> returns a checkpoint past <C>contextWindow − reserveTokens</C>,
        200_000 − 16_384.
      </>
    ),
  },
  {
    prompt: "How many assistant responses can one run make by default?",
    choices: [
      <>
        No ceiling unless the agent sets <C>steps</C>
      </>,
      "50",
      "25",
      <C key="3">maxRetries + 1</C>,
    ],
    answer: 0,
    why: (
      <>
        <C>steps</C> resolves to the agent's own. Undefined skips the check. The counter lives in{" "}
        <C>refs/chains/&lt;root&gt;</C>, so delegated continuations share it.
      </>
    ),
  },
  {
    prompt:
      "A host crashes mid-run and restarts 10 s later. The startup wake gets busy from the dead owner's lease. What drives the run again?",
    choices: [
      "Nothing until another ref on that head moves",
      <>
        A timer the runner sets for the lease's <C>expiresAt</C>
      </>,
      "The 1 s runner restart delay",
      <C key="2">runs.wait</C>,
    ],
    answer: 1,
    why: (
      <>
        Lease expiry writes no event, so on <C>busy</C> the runner calls <C>driveAt</C> with the
        holder's <C>expiresAt</C>, at least 250 ms out.
      </>
    ),
  },
  {
    prompt:
      "Deltas stream during respond. Another host takes over the expired lease, and this host's publish is fenced. Are the deltas in the log?",
    choices: [
      "No, the outbox discards them",
      "Yes, and they become a commit",
      "Yes, keyed by run id and attempt, but no commit lands for them",
      "Only if the lease is still held",
    ],
    answer: 2,
    why: (
      <>
        The outbox appended them before the takeover. Clients treat deltas as provisional until{" "}
        <C>head_moved</C> shows the commit.
      </>
    ),
  },
  {
    prompt: (
      <>
        <C>heads.move</C> reads the tip and finds no live run. Before its CAS, a message lands and a
        run starts. What does the move answer?
      </>
    ),
    choices: [
      <C key="0">busy</C>,
      <C key="1">moved_since</C>,
      <>
        <C>moved</C>, and the new run ends <C>superseded</C>
      </>,
      "It retries until the head rests",
    ],
    answer: 1,
    why: (
      <>
        Landing moved the tip, so the CAS from the tip it read loses. A move takes no lease and
        never retries.
      </>
    ),
  },
  {
    prompt:
      "A model sends a child a request, then the user stops the parent run. The child answers afterwards. What does the answer do?",
    choices: [
      "Starts a continuation under the parent's chain",
      "Waits in the parent's inbox for the next user message",
      "Is dropped at once",
      "Aborts the child",
    ],
    answer: 1,
    why: (
      <>
        Stop rewrites the request's authorization to <C>input</C>. The answer is then an
        unauthorized <C>answer</C>, and <C>decide</C> says <C>wait</C> on an idle head.
      </>
    ),
  },
];

const styles = create({
  bar: { display: "flex", alignItems: "center", gap: 12 },
  score: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: { display: "flex", flexDirection: "column", gap: 4 },
  /* The number sits in the same 15px lane, 6px from the text, as the rows' letters below it. */
  prompt: { display: "flex", gap: 6, maxWidth: 700, margin: 0, marginBlockEnd: 2, fontWeight: 500 },
  number: {
    flexShrink: 0,
    width: glyph.box,
    textAlign: "center",
    color: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  choices: { display: "flex", flexDirection: "column", maxWidth: 706, marginInlineStart: -6 },
  choice: { whiteSpace: "normal", fontSize: type.fontBase, lineHeight: type.leadingBase },
  marker: {
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 500,
  },
  right: { color: role.contentInteractiveTertiary },
  wrong: { color: role.contentInteractiveTertiary },
  dim: { color: role.contentSecondary },
  why: { maxWidth: 700, margin: 0, paddingInlineStart: 21, color: role.contentSecondary },
});

const LETTERS = ["A", "B", "C", "D"] as const;

function marker(settled: boolean, isAnswer: boolean, isPicked: boolean, option: number) {
  if (settled && isAnswer)
    return <Icon name="checkmark" size={14} xstyle={[intent.success, styles.right]} />;
  if (isPicked) return <Icon name="x" size={14} xstyle={[intent.danger, styles.wrong]} />;

  return <span {...props(styles.marker)}>{LETTERS[option]}</span>;
}

export function Quiz() {
  const [picked, setPicked] = useState<ReadonlyMap<number, number>>(new Map());

  const correct = [...picked].filter(
    ([question, choice]) => QUESTIONS[question]?.answer === choice,
  ).length;

  return (
    <>
      <div {...props(styles.bar)}>
        <span {...props(styles.score)}>
          {correct} of {QUESTIONS.length} right
          {picked.size < QUESTIONS.length ? `, ${QUESTIONS.length - picked.size} to go` : ""}
        </span>
        {picked.size > 0 && (
          <Button variant="outline" size="sm" onClick={() => setPicked(new Map())}>
            Start over
          </Button>
        )}
      </div>
      <ol {...props(styles.list)}>
        {QUESTIONS.map((question, index) => {
          const choice = picked.get(index);
          const settled = choice !== undefined;

          return (
            <li key={index} {...props(styles.item)}>
              <p {...props(styles.prompt)}>
                <span {...props(styles.number)}>{index + 1}</span>
                <span>{question.prompt}</span>
              </p>
              <div
                role="group"
                aria-label={`Answers to question ${index + 1}`}
                {...props(styles.choices)}
              >
                {question.choices.map((label, option) => (
                  <Row key={option} interactive={!settled} selected={choice === option}>
                    <Row.Primary
                      disabled={settled}
                      onClick={() => setPicked(new Map(picked).set(index, option))}
                    >
                      <Row.Leading>
                        {marker(settled, option === question.answer, choice === option, option)}
                      </Row.Leading>
                      <Row.Label
                        xstyle={[
                          styles.choice,
                          settled && option !== question.answer && option !== choice && styles.dim,
                        ]}
                      >
                        {label}
                      </Row.Label>
                    </Row.Primary>
                  </Row>
                ))}
              </div>
              {settled && <p {...props(styles.why)}>{question.why}</p>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
