/**
 * The kernel guide, read top down: the layer stack, one message through it,
 * each layer in the order the message meets it, the store underneath, then
 * reference tables, open issues and a quiz.
 */
import { create, props } from "@stylexjs/stylex";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Row } from "@nyte-ai/ui/row";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { t } from "@nyte-ai/ui/vars.stylex";
import { useEffect, useState } from "react";
import { Diff, Sketch, Source } from "./code";
import { ADMISSION, CONSTANTS, FUNCTION_GROUPS, PHASES, REFS } from "./data";
import { EXCERPTS } from "./excerpts";
import { Cas, LayerStack, Trace, TraceStep, type Layer } from "./figures";
import { ISSUE_GROUPS } from "./issues";
import { Quiz } from "./quiz";
import { KERNEL, REVISION, sourceUrl } from "./source";
import { C, Codes, H3, Inline, List, P, Section, Src, Table, To } from "./ui";

interface ContentsGroup {
  readonly group: string;
  readonly sections: readonly (readonly [id: string, title: string])[];
}

const CONTENTS: readonly ContentsGroup[] = [
  {
    group: "Overview",
    sections: [
      ["architecture", "Architecture"],
      ["message", "Life of a message"],
    ],
  },
  {
    group: "Runtime",
    sections: [
      ["runner", "Runner"],
      ["step", "Step"],
      ["admission", "Admission"],
      ["respond", "Respond"],
      ["tools", "Tools"],
      ["stop", "Stop"],
      ["events", "Events"],
      ["plugins", "Plugins"],
    ],
  },
  {
    group: "Storage",
    sections: [
      ["store", "Store"],
      ["refs", "Refs"],
      ["objects", "Objects"],
    ],
  },
  {
    group: "Reference",
    sections: [
      ["constants", "Constants"],
      ["functions", "Functions"],
      ["issues", "Open issues"],
      ["quiz", "Quiz"],
    ],
  },
];

const SECTIONS = CONTENTS.flatMap((entry) => entry.sections);

const LAYERS: readonly Layer[] = [
  {
    name: "Client",
    icon: "computer",
    files: "@nyte-ai/client",
    role: "Sends messages, stops runs, answers parked calls. Folds the event log into session state.",
    href: "#events",
  },
  {
    name: "SDK",
    icon: "code-brackets",
    files: "sdk/nyte.ts, sdk/session-pool.ts",
    role: "`createNyte`. Queues input, reads state, and keeps one runner per attached session.",
    href: "#message",
  },
  {
    name: "Runner",
    icon: "refresh",
    files: "sdk/runner.ts, sdk/advance.ts",
    role: "One loop per session per host. Every ref event wakes a head; every wake drives it until it rests.",
    href: "#runner",
  },
  {
    name: "Step",
    icon: "arrow-right",
    files: "step.ts, admission.ts, queue.ts",
    role: "Holds the head lease. Reads the refs, advances the run by one phase, publishes one CAS.",
    href: "#step",
  },
  {
    name: "Turn",
    icon: "sparkle",
    files: "turn.ts, effects.ts, loop/",
    role: "One model response or one tool batch: context, checkpoints, retries, durable tool effects.",
    href: "#respond",
  },
  {
    name: "Plugins",
    icon: "apps",
    files: "plugins/, sdk/activation.ts",
    role: "Beside the turn. Tools it can call and hooks that intercept it, each call on a time budget.",
    href: "#plugins",
  },
  {
    name: "Store",
    icon: "server",
    files: "store.ts, sqlite.ts, postgres/",
    role: "Objects, refs, leases, events. The only state two hosts share.",
    href: "#store",
  },
];

const page = create({
  root: {
    minHeight: "100vh",
    backgroundColor: t.bgBase,
    color: t.contentPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontLg,
    lineHeight: t.leadingLg,
    letterSpacing: t.letterLg,
  },
  frame: {
    display: "flex",
    justifyContent: "center",
    gap: 48,
    paddingBlock: "56px 120px",
    paddingInline: 24,
  },
  toc: {
    display: { default: "flex", "@media (max-width: 1079px)": "none" },
    flexDirection: "column",
    gap: 16,
    position: "sticky",
    insetBlockStart: 24,
    alignSelf: "flex-start",
    width: 188,
    flexShrink: 0,
    maxHeight: "calc(100vh - 48px)",
    overflowY: "auto",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
  },
  tocGroup: { display: "flex", flexDirection: "column" },
  tocLabel: {
    paddingInline: 6,
    paddingBlockEnd: 2,
    color: t.contentSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    fontWeight: 500,
  },
  article: { width: "min(840px, 100%)", minWidth: 0 },
  hero: { display: "flex", flexDirection: "column", gap: 10 },
  kicker: {
    margin: 0,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontWeight: 500,
  },
  title: {
    margin: 0,
    fontSize: "28px",
    lineHeight: "34px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
  },
  lede: { margin: 0, maxWidth: "64ch", color: t.contentSecondary, textWrap: "pretty" },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    color: t.contentSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  metaLink: {
    color: { default: t.contentSecondary, ":hover": t.contentPrimary },
    fontFamily: t.fontMono,
    fontSize: t.fontXs,
    textDecoration: "none",
  },
  inlineContents: {
    display: { default: "none", "@media (max-width: 1079px)": "flex" },
    flexWrap: "wrap",
    gap: "4px 20px",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  inlineLink: {
    color: { default: t.contentSecondary, ":hover": t.contentPrimary },
    textDecoration: "none",
  },
  appearance: { alignSelf: "flex-start" },
  /* Hover and keyboard focus only: a clicked row should not stay lit after its panel opens. */
  issueRow: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.bgHover },
      ":has(:focus-visible)": t.bgHover,
    },
  },
  group: { display: "flex", flexDirection: "column", gap: 8 },
  issues: { display: "flex", flexDirection: "column", marginInline: -6 },
  issueName: { fontFamily: t.fontMono, fontSize: t.fontBase },
  issueMeta: { fontFamily: t.fontMono, fontSize: t.fontXs },
  chevron: { color: t.contentSecondary },
  issueWhy: { whiteSpace: "normal" },
  issuePanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingInlineStart: 27,
    paddingInlineEnd: 6,
    paddingBlock: "4px 16px",
  },
  term: { scrollMarginBlockStart: 24 },
});

function useCurrentSection(): string {
  const [current, setCurrent] = useState("architecture");

  useEffect(() => {
    let frame = 0;

    const measure = (): void => {
      frame = 0;
      const line = window.innerHeight * 0.25;
      let found = "architecture";

      for (const [id] of SECTIONS) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;

        if (top !== undefined && top <= line) found = id;
      }

      setCurrent(found);
    };

    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return current;
}

function Contents(input: {
  readonly appearance: "light" | "dark";
  readonly onAppearance: (appearance: "light" | "dark") => void;
}) {
  const current = useCurrentSection();

  return (
    <nav aria-label="Contents" {...props(page.toc)}>
      {CONTENTS.map((entry) => (
        <div key={entry.group} {...props(page.tocGroup)}>
          <span {...props(page.tocLabel)}>{entry.group}</span>
          {entry.sections.map(([id, title]) => (
            <Row
              key={id}
              variant="nav"
              selected={current === id}
              aria-current={current === id ? "location" : undefined}
              render={<a href={`#${id}`} />}
            >
              <Row.Label>{title}</Row.Label>
            </Row>
          ))}
        </div>
      ))}
      <ToggleGroup
        aria-label="Appearance"
        xstyle={page.appearance}
        value={[input.appearance]}
        onValueChange={(next) => {
          const picked = next.at(0);

          if (picked === "light" || picked === "dark") input.onAppearance(picked);
        }}
      >
        <Toggle value="light" size="sm">
          Light
        </Toggle>
        <Toggle value="dark" size="sm">
          Dark
        </Toggle>
      </ToggleGroup>
    </nav>
  );
}

export function CoreGuide(input: {
  readonly appearance: "light" | "dark";
  readonly onAppearance: (appearance: "light" | "dark") => void;
}) {
  return (
    <div {...props(page.root)}>
      <div {...props(page.frame)}>
        <Contents appearance={input.appearance} onAppearance={input.onAppearance} />
        <main {...props(page.article)}>
          <header {...props(page.hero)}>
            <p {...props(page.kicker)}>Kernel guide</p>
            <h1 {...props(page.title)}>Nyte core</h1>
            <p {...props(page.lede)}>
              Each session is a small git repository. Objects never change, refs are the only
              mutable state, and every write is a compare-and-swap on refs. On each head one runner
              holds a lease, advances the run by one phase, and publishes the result in a single
              CAS.
            </p>
            <div {...props(page.meta)}>
              <a
                href={sourceUrl(KERNEL)}
                target="_blank"
                rel="noreferrer"
                {...props(page.metaLink)}
              >
                packages/{KERNEL} ↗
              </a>
              <span>
                Read at{" "}
                <a
                  href={`https://github.com/interfaces-lab/nyte/commit/${REVISION}`}
                  target="_blank"
                  rel="noreferrer"
                  {...props(page.metaLink)}
                >
                  {REVISION.slice(0, 7)}
                </a>
              </span>
            </div>
            <nav aria-label="Contents" {...props(page.inlineContents)}>
              {SECTIONS.map(([id, title]) => (
                <a key={id} href={`#${id}`} {...props(page.inlineLink)}>
                  {title}
                </a>
              ))}
            </nav>
          </header>

          <Section id="architecture" group="Overview" title="Architecture">
            <P>
              Core is a stack. Work moves down it: a client queues a message, a runner notices, a
              step lands it, a turn calls the model. Results move back up as events in the store's
              log, which every layer above can watch.
            </P>
            <LayerStack layers={LAYERS} />
            <P>Three rules hold at every layer.</P>
            <List>
              <li>
                A step keeps nothing in memory. The next step starts again from the refs, so any
                host can take over a head between two steps.
              </li>
              <li>
                A runner writes only through <C>refs.update</C>, carrying the head lease and
                asserting that <C>refs/deleted</C> is absent. A stale lease or a moved ref loses the
                whole write.
              </li>
              <li>
                No submission fails because a run is live. Contention exists only on leases, on a
                runner's publish, and on structural head operations.
              </li>
            </List>
            <H3>Two drivers</H3>
            <P>
              Something has to call <C>step</C>. A long-lived host attaches a runner; a serverless
              host calls <C>nyte.advance</C> from its own scheduler. Both run the same step under
              the same lease.
            </P>
            <Table
              head={["Driver", "Used by", "Loop"]}
              rows={[
                [
                  <To key="0" href="#runner">
                    runner
                  </To>,
                  "Desktop and TUI hosts",
                  "Watches ref events, wakes the head, drives it until it rests.",
                ],
                [
                  <To key="0" href="#fn-advanceStep">
                    nyte.advance
                  </To>,
                  "Serverless schedulers",
                  <>
                    One step per call. Answers <C>idle</C>, <C>continue</C>, <C>finished</C>,{" "}
                    <C>fenced</C>, <C>retry</C> with <C>at</C>, <C>waiting</C> with <C>until</C>, or{" "}
                    <C>busy</C> with the lease expiry. The caller schedules the next call.
                  </>,
                ],
              ]}
            />
          </Section>

          <Section id="message" title="Life of a message">
            <P>
              Follow one <C>messages.send</C> from the SDK until the head is idle again. A step that
              writes ends in <C>refs.update</C>, and its table lists every ref the update compares.
              An <C>=</C> marks an assertion. The ref must hold that value, and nothing is written.
            </P>
            <Trace>
              <TraceStep number={1} title="Submit" where={<Src path="queue.ts" line={199} />}>
                <P>
                  <C>messages.send</C> writes a <C>Change</C> object, then moves the inbox tip to
                  it. It takes no lease, so a submit never waits on a run. With a key, the same CAS
                  claims <C>refs/keys/&lt;key&gt;</C>, so a retried send answers <C>duplicate</C>. A
                  lost tip race retries, and <C>reconcileRunner</C> starts the session's runner
                  without waiting for it.
                </P>
                <Cas
                  reason="submit"
                  note="no lease"
                  moves={[
                    { ref: "inbox/main/next/tip", from: "tip", to: "change" },
                    { ref: "keys/<key>", from: "null", to: "change, when keyed" },
                  ]}
                />
              </TraceStep>
              <TraceStep number={2} title="Wake" where={<Src path="sdk/runner.ts" line={389} />}>
                <P>
                  The moved tip appends a <C>ref</C> event. The runner's watch sees it,{" "}
                  <C>handleRef</C> maps the ref to head <C>main</C>, and <C>wake</C> starts a drive.{" "}
                  <C>drive</C> takes the lease on <C>refs/heads/main</C> for 30 s. There is no run
                  yet, so <C>advance</C> calls <C>landOrIdle</C>. Nothing is published.
                </P>
              </TraceStep>
              <TraceStep number={3} title="Land" where={<Src path="step.ts" line={256} />}>
                <P>
                  <C>steer</C> is empty and <C>next</C> holds the change. Admission answers{" "}
                  <C>start</C> for a fresh head and a user lead. One CAS commits the message,
                  advances the inbox base, creates the run, and opens the chain's response counter.
                </P>
                <Cas
                  reason="land"
                  moves={[
                    { ref: "heads/main", from: "tip", to: "user commit { start }" },
                    { ref: "inbox/main/next/base", from: "base", to: "change" },
                    { ref: "runs/main", from: "null", to: "Run { phase: respond, attempts: 0 }" },
                    { ref: "chains/<run>", from: "null", to: "{ attempts: 0 }" },
                    { ref: "cancelled/<change>", from: "null", to: "null" },
                    { ref: "deleted", from: "null", to: "null" },
                  ]}
                />
              </TraceStep>
              <TraceStep number={4} title="Respond" where={<Src path="step.ts" line={667} />}>
                <P>
                  The run is in <C>respond</C>. The step reserves one response on the chain counter
                  in its own CAS, then calls <C>turn.respond</C>. Deltas reach the event log through
                  the outbox while the model writes. The finished message lands together with the
                  next phase.
                </P>
                <Cas
                  reason="reserve response"
                  moves={[
                    { ref: "chains/<run>", from: "{ attempts: 0 }", to: "{ attempts: 1 }" },
                    { ref: "deleted", from: "null", to: "null" },
                  ]}
                />
                <Cas
                  reason="respond"
                  moves={[
                    { ref: "heads/main", from: "user commit", to: "assistant commit" },
                    { ref: "runs/main", from: "Run", to: "Run { phase: tools, attempts: 1 }" },
                    { ref: "deleted", from: "null", to: "null" },
                  ]}
                />
              </TraceStep>
              <TraceStep number={5} title="Tools" where={<Src path="step.ts" line={888} />}>
                <P>
                  Each call gets an effect ref, which moves from <C>intent</C> to <C>result</C> in
                  its own leased CAS with reason <C>effect</C>. Once every call has settled, one CAS
                  lands the results and clears the effects.
                </P>
                <Cas
                  reason="tools"
                  moves={[
                    { ref: "heads/main", from: "assistant commit", to: "tool result commits" },
                    { ref: "runs/main", from: "Run", to: "Run { phase: respond }" },
                    { ref: "effects/<run>/<call>", from: "result", to: "null" },
                    { ref: "deleted", from: "null", to: "null" },
                  ]}
                />
              </TraceStep>
              <TraceStep number={6} title="Finish" where={<Src path="step.ts" line={1124} />}>
                <P>
                  The model answers without tool calls. <C>respond</C> publishes the message with
                  phase <C>done</C> and <C>drive</C> returns <C>finished</C>. The run-ref events
                  from this drive marked the head dirty, so <C>wake</C> drives once more.{" "}
                  <C>landOrIdle</C> finds nothing, the drive answers <C>idle</C>, and the lease is
                  released.
                </P>
                <Cas
                  reason="respond"
                  note="after a second reserve"
                  moves={[
                    { ref: "heads/main", from: "tool result commit", to: "assistant commit" },
                    { ref: "runs/main", from: "Run", to: "Run { phase: done, attempts: 2 }" },
                    { ref: "deleted", from: "null", to: "null" },
                  ]}
                />
              </TraceStep>
            </Trace>
          </Section>

          <Section id="runner" group="Runtime" title="Runner">
            <P>
              A host keeps one loop per attached session. The loop never polls. It watches the
              store's event log, and every ref event names a head to wake.
            </P>
            <Sketch
              title="loop and wake, sdk/runner.ts"
              code={`async function loop() {
  const watching = session.events.watch({ afterSeq: await session.events.last() });

  // A head may hold pending changes from before this host started.
  for (const { head } of await listSessionHeads(session)) wake(head);

  // A heads, inbox, runs or effects ref names the head to wake.
  for await (const event of watching) {
    if (event.kind === "ref") await handleRef(event);
  }
}

function wake(head: HeadName) {
  state.dirty = true;
  if (state.running) return; // the running pass will see dirty

  state.running = (async () => {
    while (state.dirty) {
      state.dirty = false;
      const outcome = await drive(session, turn, optionsFor(head, signal));

      if (outcome.kind === "busy") return; // another host holds the lease

      if (outcome.kind === "waiting") {
        await jobs.recheck(outcome.run.id);
        await delegation.recheck(outcome.run.id);

        // A timer that calls wake at the nearest parked deadline.
        if (outcome.until !== undefined) driveAt(head, outcome.until);
      }
    }
  })();
}`}
            />
            <P>
              The dirty flag is the whole scheduler. A ref event during a drive only marks the head,
              and the running pass drives again when it sees the mark. That is how a message queued
              mid-run lands after the run ends, without a timer.
            </P>
            <Source title="drive" excerpt={EXCERPTS.drive} />
            <P>
              <C>drive</C> holds one lease for as many steps as the head needs. It renews before
              each step and lets go when a step answers anything but <C>continue</C> or <C>retry</C>
              . During a provider or tool call, <C>withLeaseRenewal</C> renews every 10 s, and a
              failed renewal aborts the call.
            </P>
          </Section>

          <Section id="step" title="Step">
            <P>
              <C>step</C> is one leased unit of work. <C>runStep</C> settles any leftover checkpoint
              work, reads the tip, the run and <C>refs/deleted</C>, and hands the run to{" "}
              <C>advance</C>, which switches on its phase.
            </P>
            <Source title="advance" excerpt={EXCERPTS.advance} />
            <Table head={["Phase", "Handler", "Work", "Next"]} rows={PHASES} nowrap={[1]} />
            <H3>One way to write</H3>
            <P>Every run and head write goes through one function.</P>
            <Source title="publish" excerpt={EXCERPTS.publish} />
            <P>
              The appended update is an assertion. It writes nothing, but it must hold, so once{" "}
              <C>sessions.delete</C> writes <C>refs/deleted</C>, every runner publish conflicts.
              Effect writes are the exception. They call <C>refs.update</C> with the lease alone.
            </P>
            <H3>When a publish loses</H3>
            <P>
              A <C>conflict</C> means another writer moved a ref first. <C>afterConflict</C>{" "}
              re-reads the run and the tip and decides from what it finds.
            </P>
            <Table
              head={["Found", "Outcome"]}
              rows={[
                [
                  "Another run on the head",
                  <>
                    <C>fenced</C>. This host stops.
                  </>,
                ],
                [
                  <>
                    The same run, with <C>abortRequested</C>
                  </>,
                  <>
                    A stop raced the step. Keep the output and end <C>aborted</C>, or keep{" "}
                    <C>tools</C> or <C>waiting</C> with reason <C>interrupt</C>.
                  </>,
                ],
                [
                  "The same run, tip moved",
                  <>
                    End <C>aborted</C> with reason <C>superseded</C>.
                  </>,
                ],
                [
                  "Anything else",
                  <>
                    <C>continue</C>. The next step re-reads.
                  </>,
                ],
              ]}
            />
          </Section>

          <Section id="admission" title="Admission">
            <P>
              Admission decides what queued input may land, and whether it may start model work.
              User input starts a run. So does a delegate's answer to a request that a run
              authorized and did not stop. Background results, reconnects and ref events can wake a
              runner, but they never start a run.
            </P>
            <Sketch
              title="land, step.ts"
              code={`// Pending is (base, tip], minus anything with a refs/cancelled/* tombstone.
const queued = await pendingIn(session, { head, delivery });

// At a boundary that owes an answer, only leading answers and reports.
// Otherwise drain "one" takes everything through the first user change.
const batch = atBoundary
  ? boundaryBatch(queued, drain, awaitingAnswer)
  : nextBatch(queued, drain);

const decision = decide(headFor(run), await leadFor(session, batch), agentChanged(run, batch));`}
            />
            <Table
              head={[
                "Head \\ lead",
                "none",
                "user",
                "passive",
                "report",
                "authorized answer",
                "other answer",
              ]}
              nowrap={[0, 1, 2, 3, 4, 5, 6]}
              rows={ADMISSION.map(([head, ...cells]) => [<C key="0">{head}</C>, ...cells])}
            />
            <List>
              <li>
                <C>fresh</C> has no run and <C>idle</C> has a terminal one. <C>live</C> is any other
                phase, and <C>settling</C> is live with <C>abortRequested</C>.
              </li>
              <li>
                <C>join*</C> becomes <C>handoff</C> when the batch names another agent. Handoff ends
                the run <C>done</C> and leaves the batch pending for a new run.
              </li>
              <li>
                An authorized answer is a child's answer to a live delegation. It starts a
                continuation that inherits the chain counter, and the landing CAS consumes the
                authorization.
              </li>
              <li>
                A live head is decided only at a <C>respond</C> boundary, which lands only{" "}
                <C>steer</C>. <C>next</C> waits for <C>landOrIdle</C>.
              </li>
            </List>
          </Section>

          <Section id="respond" title="Respond">
            <P>
              <C>respond</C> runs its checks in a fixed order. Anything that changes the run
              publishes and returns, and the next step starts the list again.
            </P>
            <Sketch
              title="respond, step.ts"
              code={`await land("steer", boundary); // a joining batch returns continue
if (run.abortRequested) return endRun("aborted");
if (!lastIsUserOrToolResult) return endRun("done");
if (resolvedConfig !== run.config) return storeRun(resolved); // phase stays respond
if (chain.attempts >= ceiling) return endRun(failed("step ceiling"));

await publish({ chains: chain.attempts + 1 }, "reserve response");
const outcome = await callTurn(turn.respond); // lease renewal and outbox around the call

if (outcome.kind === "checkpoint") return publishCheckpoint(outcome); // phase stays respond
await publish({ head: assistantCommit, run: nextPhase(outcome) }, "respond");`}
            />
            <Table
              head={["stopReason", "Outcome", "Phase"]}
              widths={["230px", "auto", "200px"]}
              rows={[
                [
                  <Codes key="0" items={["toolUse", "stop", "pending", "deferred"]} />,
                  "Tools when the message has tool calls, otherwise complete.",
                  <Codes key="2" items={["tools", "done"]} />,
                ],
                [
                  <C key="0">length</C>,
                  <>
                    The same. <C>turn.tools</C> then fails every call as truncated.
                  </>,
                  <Codes key="2" items={["tools", "done"]} />,
                ],
                [
                  <C key="0">error</C>,
                  "An eligible overflow tries a checkpoint first. Otherwise a retryable failure under the limit retries, and anything else fails.",
                  <Codes key="2" items={["respond", "retry", "failed"]} />,
                ],
                [<C key="0">aborted</C>, "The call was cancelled.", <C key="2">aborted</C>],
              ]}
            />
            <P>
              Retries cover <C>rate_limit</C>, <C>overloaded</C> and <C>network</C>
              {"\u00a0"}
              <Src root="ai/src" path="utils/failure.ts" line={265} />. Three retries wait 1 s, 2 s
              and 4 s, or the provider's <C>retryAfterMs</C> when it is longer. <C>phase.at</C> is
              stored on the run, so any host can resume the retry.
            </P>
            <H3>Checkpoints</H3>
            <P>
              <C>turn.respond</C> checkpoints before generating once the context passes{" "}
              <C>contextWindow − 16_384</C> tokens. An overflow error also tries a checkpoint, and a
              successful one replaces the failed response. While the work runs,{" "}
              <C>refs/compactions/&lt;head&gt;</C> names it; <C>publishCheckpoint</C> lands the
              checkpoint commit and clears that ref in one CAS. A successor that finds a leftover
              record clears it before anything else, and history reads stop at the newest
              checkpoint.
            </P>
          </Section>

          <Section id="tools" title="Tools">
            <P>
              <C>executeToolCalls</C> prepares calls in source order, runs them concurrently, and
              returns results in source order. <C>durableTools</C> wraps each <C>tool.execute</C> in
              an effect ref, so a crash between starting a call and landing its result can be
              recovered from the store alone.
            </P>
            <Sketch
              title="one call, turn.ts"
              code={`// effects/<run>/<call>: null → intent { tool, args, replay }
const view = await openEffect(call);

switch (decideRecovery(view)) {
  case "execute": return settle(await tool.execute(call)); // a thrown ToolWait parks instead
  case "interrupted": return settle(interruptedError); // it may have run once already
  case "blocked": return waiting(); // still parked
  case "wake": return settle(await tool.wake(call, { reply, expired }));
  case "reuse": return view.effect.result; // never runs twice
}`}
            />
            <Source title="decideRecovery" excerpt={EXCERPTS.decideRecovery} />
            <P>
              After a wake, <C>tools</C> runs the whole batch again. Settled calls reuse their
              result, so only the woken call does new work, and <C>publishTools</C> clears{" "}
              <C>effects/&lt;run&gt;/*</C> only when its CAS wins.
            </P>
            <H3>Parking a call</H3>
            <P>
              A tool parks by throwing <C>ToolWait</C>. Its effect moves to <C>waiting</C> and the
              run follows. A plugin's wait must name a <C>selection</C> someone can answer, an{" "}
              <C>until</C> the runner expires, or both, so every parked call can end. Only the
              kernel parks with neither, through <C>backgroundWait</C>, for jobs it wakes itself.
            </P>
            <Source title="ToolWaitOptions" excerpt={EXCERPTS.toolWait} />
            <P>
              <C>runs.reply</C> answers a parked call without a lease. Its <C>waitId</C> must equal
              the current waiting oid, so a stale reply cannot answer a re-park, and the CAS on that
              oid gives racing replies one winner{"\u00a0"}
              <Src path="effects.ts" line={266} />. A waiting run that asks someone reports{" "}
              <C>awaitingReply</C> and the selection's title as <C>question</C> in its summary.
            </P>
          </Section>

          <Section id="stop" title="Stop">
            <P>
              A stop is a flag on the run, written without a lease. The runner honours it at its
              next publish, and nothing clears it. A second stop is a no-op.
            </P>
            <Source title="requestAbortAtRef" excerpt={EXCERPTS.requestAbortAtRef} />
            <P>
              The flag and the revoked delegate authorizations land in one CAS.{" "}
              <C>abortLocalDrive</C> then cancels this host's provider or tool call, and{" "}
              <C>runs.abort</C> interrupts the command jobs the run owns. From there the flag works
              through the runner.
            </P>
            <Table
              head={["Where", "What the flag does"]}
              rows={[
                [
                  "An in-flight publish",
                  <>
                    Conflicts, because the flag moved <C>refs/runs/&lt;head&gt;</C>.
                  </>,
                ],
                [
                  <C key="0">afterConflict</C>,
                  <>
                    Keeps the step's output and ends the run <C>aborted</C>. A tool batch keeps{" "}
                    <C>tools</C> or <C>waiting</C> so its calls can settle first.
                  </>,
                ],
                [
                  <C key="0">respond</C>,
                  <>
                    Ends the run <C>aborted</C> before any model call.
                  </>,
                ],
                [
                  <C key="0">headFor</C>,
                  <>
                    Reads the run as <C>settling</C>, so admission lands nothing.
                  </>,
                ],
              ]}
            />
            <Source title="withPhase and endingPhase" excerpt={EXCERPTS.endingPhase} />
            <P>
              Every phase a step publishes passes through <C>withPhase</C>, so a flagged run can
              only end <C>aborted</C>. A failure it would have reported becomes a runner notice. A
              tool that ignores its signal keeps running, and the lease keeps renewing until it
              returns. Children the run created keep working; only <C>stop</C> ends a child.
            </P>
          </Section>

          <Section id="events" title="Events">
            <P>
              A client never reads refs while a run streams. It takes a snapshot, then folds events
              from the snapshot's cursor.
            </P>
            <Sketch
              title="turn to client"
              code={`// turn → store: outbox.ts
emit(delta); // buffered, flushed every 25 ms or 64 events; progress coalesces per call
await events.append(batch, { lease }); // fenced aborts the call

// store → client: nyte.watch, sdk/watch.ts
for await (const event of events.watch({ afterSeq })) {
  yield* projectEvent(event); // one kernel event → zero or more SessionEvents
}
// { kind: "synced" } marks the seq that was last when the watch began
// a cursor below the floor throws CursorExpired: take a new snapshot`}
            />
            <P>
              Deltas are keyed by run id, attempt and index, never by commit id. A commit's id is
              its hash and does not exist until the message is whole. Treat deltas as provisional
              until <C>head_moved</C> shows the commit: a fenced or lost publish can leave deltas in
              the log with no commit behind them.
            </P>
          </Section>

          <Section id="plugins" title="Plugins">
            <P>
              Plugins load per session. Each registers tools, hooks and commands into its own scope,
              and disposing the scope undoes all of it. Every call into plugin code other than a
              tool runs under a wall-clock budget, and running out counts as a thrown error. A tool
              runs as long as its call does, and a stop cancels it through the call's signal.
            </P>
            <Source title="HOOK_BUDGETS_MS" excerpt={EXCERPTS.hookBudgets} />
            <Table
              head={["Call", "Budget", "When it fails or runs out"]}
              rows={[
                [
                  <C key="0">session()</C>,
                  "5 s",
                  "The load fails and its scope is disposed. A reload keeps the old plugin.",
                ],
                [
                  <C key="0">before_tool</C>,
                  "5 s",
                  "Fails closed. The call is blocked, and the run fails with a policy error.",
                ],
                [
                  <Codes key="0" items={["transform_context", "before_request", "after_tool"]} />,
                  "5 s",
                  "Reported. The handler's result is skipped.",
                ],
                [
                  <C key="0">before_compaction</C>,
                  "300 s",
                  "The next provider, then portable compaction.",
                ],
                [
                  "command, event listener",
                  "5 s",
                  "The command rejects; a listener failure becomes a diagnostic.",
                ],
                ["disposer", "5 s", "Reported and skipped. The next disposer runs."],
              ]}
            />
            <P>
              Hooks run in plugin order. <C>before_tool</C> policies chain: <C>modify</C> hands new
              arguments to the next policy, <C>continue</C> objects to nothing, and the first{" "}
              <C>reject</C> or <C>error</C> ends the chain. A reload loads the new scope before it
              disposes the old one, so policy hooks never lapse. File plugin ids are lowercase
              letters, digits and hyphens, and <C>subagents</C> and <C>jobs</C> are reserved.
            </P>
          </Section>

          <Section id="store" group="Storage" title="Store">
            <P>
              Everything above runs on four authorities, modelled on git. <Src path="store.ts" />{" "}
              defines them, a backend implements them, and the kernel calls nothing else.
            </P>
            <Table
              head={["Git", "Kernel", "Holds"]}
              rows={[
                ["object database", <C key="1">objects</C>, "Content-addressed, immutable values."],
                [
                  "ref, update-ref",
                  <C key="1">refs</C>,
                  "The only mutable state, moved by multi-ref CAS.",
                ],
                ["lock file", <C key="1">leases</C>, "Fenced execution rights. Never history."],
                ["reflog", <C key="1">events</C>, "One ordered stream per session."],
              ]}
            />
            <P>
              Git does not fit everywhere. A commit has exactly one context parent, because model
              context is linear. There is no worktree; a client reads at any commit. A stale branch
              is carried forward with a summary commit instead of a rebase, and the event log is
              trimmed rather than kept forever.
            </P>
            <H3>One publish</H3>
            <List ordered>
              <li>
                The runner puts the new objects. Nothing names them yet, so no reader can see them.
              </li>
              <li>
                It calls <C>refs.update</C> with its lease. A stale lease answers <C>fenced</C>{" "}
                before any ref is compared{"\u00a0"}
                <Src path="sqlite.ts" line={653} />.
              </li>
              <li>
                Every ref must still hold its <C>from</C>. One mismatch answers <C>conflict</C> and
                writes nothing.
              </li>
              <li>
                Each moved ref appends a <C>ref</C> event in the same transaction, and watchers wake
                on the commit.
              </li>
            </List>
            <Source title="Refs and Leases" excerpt={EXCERPTS.refs} />
            <H3>Terms</H3>
            <Table
              head={["Term", "Meaning"]}
              rows={[
                ["object", "An immutable JSON value: commit, change, run, effect, stack or blob."],
                [
                  "body",
                  <>
                    An object's stored JSON: keys sorted by UTF-16 code unit, arrays in order,{" "}
                    <C>undefined</C> properties dropped, as RFC 8785 specifies. <C>hash.ts</C> owns
                    it, and a stored body is hashed again on every read.
                  </>,
                ],
                [
                  "oid",
                  "The SHA-256 of the body. A different body is a different object; an omitted property and one set to undefined hash the same.",
                ],
                ["ref", "A named pointer to an oid."],
                [
                  "CAS",
                  <>
                    Compare-and-swap. A ref moves to <C>to</C> only if it still holds <C>from</C>.
                  </>,
                ],
                [
                  "assertion",
                  <>
                    An update with <C>to === from</C>. It must hold, and it writes no row and no
                    event.
                  </>,
                ],
                ["lease", "An expiring lock on a name. Only its holder runs that head."],
                [
                  "fence",
                  <>
                    A lease's generation. Writes that carry an older fence answer <C>fenced</C>.
                  </>,
                ],
                ["seq", "An event's position in the session log, from 1."],
                [
                  "cursor",
                  <>
                    The last seq a reader has seen, passed as <C>afterSeq</C>.
                  </>,
                ],
                [
                  "floor",
                  <>
                    The highest trimmed seq. A cursor below it throws <C>CursorExpired</C>.
                  </>,
                ],
              ]}
            />
          </Section>

          <Section id="refs" title="Refs">
            <P>
              A feature that can be a ref is a ref. <C>&lt;delivery&gt;</C> is <C>steer</C> or{" "}
              <C>next</C>, and the SDK's default head is <C>main</C>
              {"\u00a0"}
              <Src path="names.ts" />.
            </P>
            <Table
              head={["Ref", "Holds", "Written by"]}
              rows={REFS.map(([name, holds, writer]) => [<C key="0">{name}</C>, holds, writer])}
            />
          </Section>

          <Section id="objects" title="Objects">
            <P>
              A <C>Change</C> is a message waiting to land; landing turns it into a commit. The{" "}
              <C>Run</C> object is replaced on every phase change, so the run ref's history is the
              run's history.
            </P>
            <Source title="Change and Run" excerpt={EXCERPTS.objects} />
            <Source title="RunPhase" excerpt={EXCERPTS.runPhase} />
            <P>
              <C>done</C>, <C>failed</C> and <C>aborted</C> are terminal. A commit body is a{" "}
              <C>message</C>, <C>config</C>, <C>completion</C>, <C>checkpoint</C> or <C>summary</C>.
              Every commit records when it was written, and the run that wrote it when a runner did.
              Assistant <C>calls</C> and <C>outcome</C>, a tool result's <C>call</C> and <C>tree</C>
              , and a run's <C>start</C> are provenance: the runner stamps them, and the model never
              sees them.
            </P>
          </Section>

          <Section id="constants" group="Reference" title="Constants">
            <Table
              head={["Name", "Value", "Governs", "Source"]}
              nowrap={[0, 1, 3]}
              widths={["210px", "110px", "auto", "150px"]}
              rows={CONSTANTS.map((constant) => [
                <C key="0">{constant.name}</C>,
                <C key="1">{constant.value}</C>,
                <Inline key="2" text={constant.governs} />,
                <Src key="3" root={constant.root} path={constant.path} line={constant.line} />,
              ])}
            />
          </Section>

          <Section id="functions" title="Functions">
            {FUNCTION_GROUPS.map((group) => (
              <div key={group.title} {...props(page.group)}>
                <H3>{group.title}</H3>
                <Table
                  head={["Function", "Does", "Source"]}
                  nowrap={[0, 2]}
                  widths={["180px", "auto", "150px"]}
                  rows={group.terms.map((term) => [
                    <span key="0" id={`fn-${term.id}`} {...props(page.term)}>
                      <C>{term.id}</C>
                    </span>,
                    <Inline key="1" text={term.does} />,
                    <Src key="2" path={term.path} line={term.line} />,
                  ])}
                />
              </div>
            ))}
          </Section>

          <Section id="issues" title="Open issues">
            <P>
              Each issue is real at <C>{REVISION.slice(0, 7)}</C>. Where the fix is mechanical, the
              patch is cut from the file it changes; where it needs a decision first, a sketch shows
              its shape.
            </P>
            {ISSUE_GROUPS.map((group) => (
              <div key={group.title} {...props(page.group)}>
                <H3>{group.title}</H3>
                <div {...props(page.issues)}>
                  {group.issues.map((issue) => (
                    <Collapsible.Root key={issue.name}>
                      <Row xstyle={page.issueRow}>
                        <Row.Primary render={<Collapsible.Trigger variant="plain" />}>
                          <Row.Leading>
                            <Collapsible.Chevron size={14} xstyle={page.chevron} />
                          </Row.Leading>
                          <Row.Label xstyle={page.issueName}>{issue.name}</Row.Label>
                          <Row.Meta xstyle={page.issueMeta}>
                            {issue.path.split("/").at(-1)}:{issue.line}
                          </Row.Meta>
                        </Row.Primary>
                      </Row>
                      <Collapsible.Panel hiddenUntilFound xstyle={page.issuePanel}>
                        <P>{issue.why}</P>
                        {issue.fix.kind === "patch" &&
                          issue.fix.patches.map((patch) => <Diff key={patch.path} patch={patch} />)}
                        {issue.fix.kind === "sketch" && (
                          <Sketch title={issue.fix.title} code={issue.fix.code} />
                        )}
                        {issue.fix.kind === "unused" && (
                          <Table
                            head={["Export", "Source"]}
                            rows={issue.fix.exports.map(([name, path, line]) => [
                              <C key="0">{name}</C>,
                              <Src key="1" path={path} line={line} />,
                            ])}
                          />
                        )}
                      </Collapsible.Panel>
                    </Collapsible.Root>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          <Section id="quiz" title="Quiz">
            <P>Pick an answer to see the reasoning.</P>
            <Quiz />
          </Section>
        </main>
      </div>
    </div>
  );
}
