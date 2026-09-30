import { create, props } from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { t } from "@nyte-ai/ui/vars.stylex";
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
        <C>messages.send</C> returns <C>{'{ kind: "queued" }'}</C>. What has been published?
      </>
    ),
    choices: [
      <>
        A user commit at <C>refs/heads/main</C>
      </>,
      <>
        A <C>Change</C> at <C>refs/inbox/main/next/tip</C>
      </>,
      <>
        A <C>Run</C> at <C>refs/runs/main</C>
      </>,
      "Only an event",
    ],
    answer: 1,
    why: <>Submit moves only the inbox tip. The commit and the run appear later, in land.</>,
  },
  {
    prompt: "Where does an idle runner wait for work?",
    choices: [
      <>
        A <C>setInterval</C> polling the run ref
      </>,
      <>
        The <C>for await</C> over <C>session.events.watch</C> in <C>loop()</C>
      </>,
      <>
        The <C>for (;;)</C> in <C>drive</C>
      </>,
      <C key="3">waitForHead</C>,
    ],
    answer: 1,
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
        At the next <C>respond</C> boundary
      </>,
      <>
        After the run is terminal, through <C>landOrIdle</C>
      </>,
      <>
        Never. <C>next</C> is for idle sessions only
      </>,
    ],
    answer: 2,
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
      <C key="1">join</C>,
      <C key="2">handoff</C>,
      <C key="3">start</C>,
    ],
    answer: 1,
    why: (
      <>
        Live and user is <C>join</C>. With a different agent it is <C>handoff</C>. The run ends{" "}
        <C>done</C> and the next pass starts a new one.
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
        <C>drive</C> loops on <C>finished</C>
      </>,
      <>
        Its own run-ref events marked the head dirty, so <C>wake</C> drives again
      </>,
      "A 1 s timer",
      <>
        The client calls <C>nyte.advance</C>
      </>,
    ],
    answer: 1,
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
      <C key="2">fenced</C>,
      "A's write merges with B's",
    ],
    answer: 2,
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
      "It asserts the session is not being deleted",
      "It bumps the event seq",
      "It releases the lease",
    ],
    answer: 1,
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
      <C key="1">start</C>,
      <C key="2">settle</C>,
      <C key="3">join</C>,
    ],
    answer: 2,
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
      "The call settles with an interrupted error",
      "The run parks",
      "The stored result is reused",
    ],
    answer: 1,
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
        A plugin tool parks with <C>throw new ToolWait({"{}"})</C>. What happens?
      </>
    ),
    choices: [
      "It parks until the runner wakes it",
      "It does not type-check",
      "It expires after 30 s",
      "It becomes a background wait",
    ],
    answer: 1,
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
      "After 5 s the call runs without the policy",
      "After 5 s the policy fails closed: the call settles as an error and the run fails",
      "The plugin is unloaded",
    ],
    answer: 2,
    why: (
      <>
        The hook's 5 s budget runs out and the handler counts as thrown. A thrown <C>before_tool</C>{" "}
        becomes <C>error</C>, which blocks the call and fails the run with a policy error.
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
      <C key="2">failed</C>,
      <C key="3">aborted</C>,
    ],
    answer: 2,
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
        Waits out <C>phase.at</C>, then aborts
      </>,
      <>
        Calls <C>respond</C> at once, which ends the run <C>aborted</C>
      </>,
      "Deletes the run ref",
      "Nothing until the lease expires",
    ],
    answer: 1,
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
      <>
        <C>aborted</C>, with the failure as a notice
      </>,
      <C key="2">done</C>,
      <C key="3">retry</C>,
    ],
    answer: 1,
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
        <C>contextWindow</C> is 200_000, the context is 190_000 tokens, settings are default. Does{" "}
        <C>respond</C> checkpoint first?
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
        The threshold is <C>contextWindow − reserveTokens</C>, 200_000 − 16_384.
      </>
    ),
  },
  {
    prompt: "How many assistant responses can one run make by default?",
    choices: [
      "25",
      "50",
      <>
        No ceiling unless the agent sets <C>steps</C>
      </>,
      <C key="3">maxRetries + 1</C>,
    ],
    answer: 2,
    why: (
      <>
        <C>steps</C> resolves to the agent's own. Undefined skips the check. The counter lives in{" "}
        <C>refs/chains/&lt;root&gt;</C>, so delegated continuations share it.
      </>
    ),
  },
  {
    prompt: "A host crashes mid-run and restarts 10 s later. What drives the run again today?",
    choices: [
      <>
        The runner retries at the old lease's <C>expiresAt</C>
      </>,
      "Nothing until another ref on that head moves",
      <C key="2">runs.wait</C>,
      "The 1 s runner restart delay",
    ],
    answer: 1,
    why: (
      <>
        The startup wake gets <C>busy</C> from the unexpired lease and returns. Lease expiry writes
        no event. The first open issue has the fix.
      </>
    ),
  },
  {
    prompt:
      "Deltas stream during respond. Another host takes over the expired lease, and this host's publish is fenced. Are the deltas in the log?",
    choices: [
      "No, the outbox discards them",
      "Yes, keyed by run id and attempt, but no commit lands for them",
      "Yes, and they become a commit",
      "Only if the lease is still held",
    ],
    answer: 1,
    why: (
      <>
        The outbox appended them before the takeover. Clients treat deltas as provisional until{" "}
        <C>head_moved</C> shows the commit.
      </>
    ),
  },
];

const styles = create({
  bar: { display: "flex", alignItems: "center", gap: 12 },
  score: {
    color: t.contentSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
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
    width: 15,
    textAlign: "center",
    color: t.contentSecondary,
    fontVariantNumeric: "tabular-nums",
  },
  choices: { display: "flex", flexDirection: "column", maxWidth: 706, marginInlineStart: -6 },
  choice: { whiteSpace: "normal", fontSize: t.fontBase, lineHeight: t.leadingBase },
  marker: {
    color: t.contentSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    fontWeight: 500,
  },
  right: { color: t.intentSuccessContent },
  wrong: { color: t.intentDangerContent },
  dim: { color: t.contentSecondary },
  why: { maxWidth: 700, margin: 0, paddingInlineStart: 21, color: t.contentSecondary },
});

const LETTERS = ["A", "B", "C", "D"] as const;

function marker(settled: boolean, isAnswer: boolean, isPicked: boolean, option: number) {
  if (settled && isAnswer) return <Icon name="checkmark" size={14} xstyle={styles.right} />;
  if (isPicked) return <Icon name="x" size={14} xstyle={styles.wrong} />;

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
          <Button variant="secondary" size="sm" onClick={() => setPicked(new Map())}>
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
