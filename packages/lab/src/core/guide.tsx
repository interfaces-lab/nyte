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
import { role, type } from "@nyte-ai/ui/vars.stylex";
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
      ["inbox", "Inbox"],
      ["admission", "Admission"],
      ["respond", "Respond"],
      ["tools", "Tools"],
      ["stop", "Stop"],
      ["heads", "Heads"],
      ["events", "Events"],
      ["plugins", "Plugins"],
      ["agents", "Agents"],
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
    role: "One loop per session per host. A ref event that names a head wakes it, and a wake drives the head until it rests.",
    href: "#runner",
  },
  {
    name: "Step",
    icon: "arrow-right",
    files: "step.ts, admission.ts, queue.ts",
    role: "Holds the head lease. Reads the refs, advances the run by one phase, publishes by CAS.",
    href: "#step",
  },
  {
    name: "Turn",
    icon: "sparkle",
    files: "turn.ts, effects.ts, loop/",
    role: "One model request or one tool batch: prompt declaration, checkpoints, retries, durable tool effects.",
    href: "#respond",
  },
  {
    name: "Plugins",
    icon: "apps",
    files: "../plugins/, sdk/activation.ts",
    role: "Beside the turn. Tools it can call, hooks that intercept it on a wall-clock budget, and the providers that open workspaces.",
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
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontLg,
    lineHeight: type.leadingLg,
    letterSpacing: type.letterLg,
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
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
  },
  tocGroup: { display: "flex", flexDirection: "column" },
  tocLabel: {
    paddingInline: 6,
    paddingBlockEnd: 2,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 500,
  },
  article: { width: "min(840px, 100%)", minWidth: 0 },
  hero: { display: "flex", flexDirection: "column", gap: 10 },
  kicker: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
  },
  title: {
    margin: 0,
    fontSize: "28px",
    lineHeight: "34px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
  },
  lede: { margin: 0, maxWidth: "64ch", color: role.contentSecondary, textWrap: "pretty" },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  metaLink: {
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    textDecoration: "none",
  },
  inlineContents: {
    display: { default: "none", "@media (max-width: 1079px)": "flex" },
    flexWrap: "wrap",
    gap: "4px 20px",
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  inlineLink: {
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    textDecoration: "none",
  },
  appearance: { alignSelf: "flex-start" },
  /* Hover and keyboard focus only: a clicked row should not stay lit after its panel opens. */
  issueRow: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      ":has(:focus-visible)": role.bgHover,
    },
  },
  group: { display: "flex", flexDirection: "column", gap: 8 },
  issues: { display: "flex", flexDirection: "column", marginInline: -6 },
  issueName: { fontFamily: type.fontMono, fontSize: type.fontBase },
  issueMeta: { fontFamily: type.fontMono, fontSize: type.fontXs },
  chevron: { color: role.contentSecondary },
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
              Each session is a small git repository. Objects never change. Refs are the only
              mutable state, and every ref write is a compare-and-swap. On each head one runner
              holds a lease and advances the run one phase per step.
            </p>
            <div {...props(page.meta)}>
              <a
                href={sourceUrl(KERNEL)}
                target="_blank"
                rel="noreferrer"
                {...props(page.metaLink)}
              >
                packages/{KERNEL} <span aria-hidden>↗</span>
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
              log, which every layer above can watch. A host is a process that calls{" "}
              <C>createNyte</C>. It supplies the store, the models and the plugins, and may{" "}
              <C>attach</C> runners.
            </P>
            <LayerStack layers={LAYERS} />
            <P>Three rules hold throughout.</P>
            <List>
              <li>
                A step keeps nothing in memory. The next step starts again from the refs, so any
                host can take over a head between two steps.
              </li>
              <li>
                A runner moves refs only through <C>refs.update</C>, carrying the head lease and
                asserting that <C>refs/deleted</C> is absent. A stale lease or a moved ref loses the
                whole write.
              </li>
              <li>
                No submission fails because a run is live. Contention exists only on leases, on a
                runner's publish, and on head operations that refuse a held head, such as{" "}
                <C>deleteHead</C>.
              </li>
            </List>
            <H3>Two drivers</H3>
            <P>
              Something has to call <C>step</C>. Both drivers run the same step under the same
              lease.
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
                    <C>fenced</C>, <C>retry</C> with <C>at</C>, <C>waiting</C> with an optional{" "}
                    <C>until</C>, or <C>busy</C> with the lease expiry. The caller schedules the
                    next call.
                  </>,
                ],
              ]}
            />
            <P>
              Admission is a store write and stepping is the host's decision, so a crash between
              them leaves an accepted message with no runner. The host closes the gap with an
              obligation, a durable record of a session and an optional head, written first.
            </P>
            <Sketch
              title="withDispatch, vercel/src/admission.ts"
              code={`const obligation = await outbox.record(target); // names the session and head, no content
const outcome = await admit(); // the core CAS
if (accepted(outcome)) await wake(target); // start a workflow
await outbox.settle(obligation);`}
            />
            <P>
              A reconciler re-dispatches old records, which is safe because a second <C>advance</C>{" "}
              answers <C>busy</C> or <C>idle</C>. It clears a record only past an age the host sets,
              because an admission that began earlier can still commit after the cleanup.
            </P>
          </Section>

          <Section id="message" title="Life of a message">
            <P>
              Follow one <C>messages.send</C> from the SDK until the head is idle again. Each write
              below shows its <C>refs.update</C> as a table of the refs it compares. <C>=</C> marks
              an assertion, a ref that must already hold that value and is not written.
            </P>
            <Trace>
              <TraceStep number={1} title="Submit" where={<Src path="queue.ts" line={199} />}>
                <P>
                  <C>messages.send</C> writes a <C>Change</C> object, then moves the inbox tip to
                  it. A submit never waits on a run. With a key, the same CAS claims{" "}
                  <C>refs/keys/&lt;key&gt;</C>, so a retried send answers <C>duplicate</C>. The
                  client's outbox mints the key on Enter and resends it, 500 ms apart and doubling
                  to 10 s, until the store answers <C>queued</C> or <C>duplicate</C>. Both mean the
                  change is durable. A lost tip race retries. <C>reconcileRunner</C> then starts the
                  session's runner without waiting for it.
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
                  <C>drive</C> takes the lease on <C>refs/heads/main</C> for 30 s. <C>step</C> finds
                  no run and calls <C>landOrIdle</C>.
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
                    { ref: "chains/<root>", from: "null", to: "{ attempts: 0 }" },
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
                    { ref: "chains/<root>", from: "{ attempts: 0 }", to: "{ attempts: 1 }" },
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
                  <C>landOrIdle</C> finds nothing, so the second drive answers <C>idle</C> and
                  releases its lease.
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
              store's event log and wakes the head that a heads, inbox, runs or effects ref belongs
              to.
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

      if (outcome.kind === "busy") {
        // Lease expiry writes no event: look again when the holder's lease lapses, at least 250 ms out.
        driveAt(head, Math.max(outcome.holder.expiresAt, Date.now() + BUSY_RETRY_MIN_MS));
        return;
      }

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
              A ref event during a drive only marks the head. That is how a <C>next</C> message
              queued mid-run lands after the run ends.
            </P>
            <Source title="drive" excerpt={EXCERPTS.drive} />
            <P>
              <C>drive</C> holds one lease for as many steps as the head needs. It renews before
              each step and lets go when a step answers anything but <C>continue</C> or <C>retry</C>
              . During a provider or tool call, <C>withLeaseRenewal</C> renews every 10 s, and a
              failed renewal aborts the call.
            </P>
            <H3>Who volunteers</H3>
            <P>
              <C>nyte.attach()</C> volunteers this process for every session in the store, and{" "}
              <C>{"attach({ sessions })"}</C> names some. A named session also covers the children
              it delegates to. A client that never attaches only queues. Before each step, and
              before <C>prepare</C>, <C>respond</C> and <C>tools</C>, a runner checks that its
              environment still acts where <C>refs/workspace</C> says. If another host moved the
              tree, the step throws and the session runs again once its new workspace opens here.
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
            <P>Every write a step makes to a run or head goes through one function.</P>
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
                    <C>fenced</C>. The drive ends.
                  </>,
                ],
                [
                  <>
                    The same run, with <C>abortRequested</C>
                  </>,
                  <>
                    A stop raced the step. Keep the output. A <C>tools</C> or <C>waiting</C> phase
                    publishes as is with reason <C>interrupt</C>. Anything else ends <C>aborted</C>.
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

          <Section id="inbox" title="Inbox">
            <P>
              Submitting never touches the head. The submitter stamps <C>kind</C> and{" "}
              <C>delivery</C> on the change, and nothing infers them later. An automatic delivery is{" "}
              <C>steer</C> while the head has a live run and <C>next</C> otherwise.
            </P>
            <Table
              head={["Source", "kind", "delivery"]}
              nowrap={[0, 1]}
              rows={[
                [<C key="0">messages.send</C>, <C key="1">user</C>, "The caller's, or automatic"],
                [<C key="0">sessions.configure</C>, <C key="1">passive</C>, "Automatic"],
                ["A background command ends", <C key="1">report</C>, <C key="2">steer</C>],
                ["A child answers a request", <C key="1">answer</C>, <C key="2">steer</C>],
              ]}
            />
            <H3>Two chains</H3>
            <P>
              Each head has a <C>steer</C> chain and a <C>next</C> chain, each with a <C>tip</C> and
              a <C>base</C>. A change names the tip it followed in <C>previous</C>, so pending is{" "}
              <C>(base, tip]</C> read back from the tip and no ref holds a list. <C>steer</C> lands
              at every response boundary and when the head is idle. <C>next</C> lands only when the
              head is idle and <C>steer</C> waits. <C>pending</C> merges the two chains by
              submission time without reordering either, so a redelivered copy, which keeps its
              time, stays where <C>before</C> put it.
            </P>
            <P>
              <C>drain</C> sets how much one landing takes. <C>"one"</C> takes everything through
              the first <C>user</C> change, so a <C>report</C> or <C>passive</C> change queued ahead
              of it lands with it, and a chain with no <C>user</C> change lands whole. <C>"all"</C>{" "}
              takes the chain.
            </P>
            <H3>Cancel and redeliver</H3>
            <P>
              Only a landing or a cancel takes a change out of pending, so a run that fails, aborts
              or is superseded leaves every pending change where it was. A cancel that races a
              landing has one winner. If the landing wins, the cancel reads again and answers{" "}
              <C>landed</C>.
            </P>
            <Cas
              reason="cancel"
              note="no lease"
              moves={[
                { ref: "cancelled/<change>", from: "null", to: "tombstone" },
                { ref: "inbox/main/<delivery>/base", from: "base", to: "base" },
              ]}
            />
            <P>
              <C>redeliver</C> changes a pending item's <C>delivery</C>, moves it with <C>before</C>
              , or replaces a pending user message's content, in one CAS. It tombstones the change
              and every change after the splice point, asserts the source base, and rewrites that
              suffix after the target's tip.
            </P>
          </Section>

          <Section id="admission" title="Admission">
            <P>
              Admission decides what queued input may land, and whether it may start model work.
              User input starts a run. So does a delegate's answer to a request its run authorized,
              unless that run was stopped or failed.
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
                phase, and <C>settling</C> is live with <C>abortRequested</C>. A live head is
                decided only at a <C>respond</C> boundary.
              </li>
              <li>
                The lead is the batch's first <C>user</C> change or authorized <C>answer</C>.
                Without one it is <C>passive</C> when any change in the batch is passive, and
                otherwise the first <C>report</C> or unauthorized <C>answer</C>.
              </li>
              <li>
                <C>join*</C> becomes <C>handoff</C> when the batch names another agent. Handoff ends
                the run <C>done</C> and leaves the batch pending.
              </li>
              <li>
                An authorized answer is a child's answer to a request whose run was neither stopped
                nor failed, and that no landing has consumed. It starts a continuation that inherits
                the chain counter, and the landing CAS consumes the authorization.
              </li>

              <li>
                On an idle head a <C>report</C> or unauthorized <C>answer</C> starts nothing. The
                next run picks it up in its first batch or at its first <C>respond</C> boundary. A{" "}
                <C>passive</C> lead lands its batch without a model call.
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

const prepared = await callTurn(turn.prepare); // not an attempt
if (prepared.kind === "checkpoint") return publishCheckpoint(prepared); // phase stays respond
if (prepared.kind === "system") tip = await publishSystem(prepared.message);

await publish({ chains: chain.attempts + 1 }, "reserve response");
const outcome = await callTurn(turn.respond); // lease renewal and outbox around the call

if (outcome.kind === "checkpoint") return publishCheckpoint(outcome); // overflow; phase stays respond
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
              A host that cannot supply the model a run recorded fails <C>respond</C> with a runner
              failure. It never answers under a substitute.
            </P>
            <P>
              Retries cover <C>rate_limit</C>, <C>overloaded</C> and <C>network</C>
              {"\u00a0"}
              <Src root="ai/src" path="utils/failure.ts" line={265} />. Three retries wait 1 s, 2 s
              and 4 s, or the provider's <C>retryAfterMs</C> when it is longer. <C>phase.at</C> is
              stored on the run, so any host can resume the retry. Each retry commits the failed
              attempt and adds one to <C>attempts</C>. A request reserves its response before the
              call, so retries spend the step ceiling, and so does a crash mid-request, which
              repeats the call.
            </P>
            <H3>Prepare</H3>
            <P>
              <C>turn.prepare</C> compares the branch with the prompt and tools this host wants the
              model to have. When the branch lacks some, it returns one <C>system</C> message that
              declares them. The step commits that and goes on to <C>turn.respond</C>, so a resumed
              run finds nothing left to declare.
            </P>
            <H3>Checkpoints</H3>
            <P>
              <C>turn.prepare</C> checkpoints once the context passes <C>contextWindow − 16_384</C>{" "}
              tokens. An overflow error from <C>turn.respond</C> also tries a checkpoint, and a
              successful one replaces the failed response. While the work runs,{" "}
              <C>refs/compactions/&lt;head&gt;</C> names it; <C>publishCheckpoint</C> lands the
              checkpoint commit and clears that ref in one CAS. A successor that finds a leftover
              record clears it before anything else. History reads stop at the newest checkpoint.
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
              code={`// effects/<run>/<call>: null → intent { tool, args, replay, environment: env.id }
const view = await openEffect(call);

switch (decideRecovery(view, env.id)) {
  case "execute": return settle(await tool.execute(input, call)); // a thrown ToolWait parks instead
  case "interrupted": return settle(interruptedError); // it may have run once already
  case "blocked": return waiting(); // still parked
  case "wake": return settle(await tool.wake(call, { reply, expired }));
  case "reuse": return view.effect.result; // never runs twice
}`}
            />
            <P>
              An effect ref holds one immutable object per state. <C>intent</C> moves to{" "}
              <C>result</C>, or to <C>waiting</C> when the tool parks. A reply moves <C>waiting</C>{" "}
              to <C>signal</C>, the deadline moves it to <C>expired</C>, and a stop settles it to{" "}
              <C>result</C>. <C>wake</C> then settles the call or parks it again, and <C>tools</C>{" "}
              runs the whole batch again. Settled calls reuse their result, so only the woken call
              does new work, and <C>publishTools</C> clears <C>effects/&lt;run&gt;/*</C> only when
              its CAS wins.
            </P>
            <H3>Where a call acts</H3>
            <P>
              A tool acts through <C>call.env</C>, an <C>ExecutionEnv</C>: an environment <C>id</C>,
              a <C>cwd</C>, <C>resolve</C> for paths, file operations and <C>exec</C>. Built-in
              tools reach files and processes only through it. <C>activation.tools()</C> binds the
              activation's env outside every plugin wrapper, so a plugin's <C>draft.wrap</C> and the
              jobs wrapper see it too. The env opens where the root's <C>refs/workspace</C> says,
              through the provider plugin for its <C>kind</C>. A plugin's <C>wrapEnv</C> extends its
              operations and never changes its <C>id</C>.
            </P>
            <P>
              <C>sessions.create</C> writes <C>refs/workspace</C> before it returns, from the root's{" "}
              <C>workspace</C> input or <C>defaultWorkspace</C>. <C>relocate</C> moves a whole tree
              to another workspace and answers <C>relocated</C>, <C>busy</C> or the destination's
              refusal. <C>busy</C> means a live drive, a non-terminal run, queued work the runner
              would land, a running job or a held lease anywhere in the tree.
            </P>
            <P>
              A <C>safe</C> intent reruns only when the resuming runner's environment <C>id</C>{" "}
              equals the one its intent recorded. Otherwise it settles <C>interrupted</C>, as does
              an intent that recorded none. A <C>never</C> call runs at most once.
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
              the current waiting oid, so a stale reply cannot answer a re-park. The CAS on that oid
              gives racing replies, and a reply racing the deadline, one winner{"\u00a0"}
              <Src path="effects.ts" line={266} />. A reply at or after <C>until</C> answers{" "}
              <C>not_waiting</C>. Core checks a selection before it writes one, and a malformed one
              fails its call as a tool error. It stores a reply as given, and the tool's <C>wake</C>{" "}
              handler decides what it means. A waiting run that asks someone reports{" "}
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
              <C>runs.abort</C> interrupts the command jobs the run owns.
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
              A failure it would have reported becomes a runner notice. A tool that ignores its
              signal keeps running, and the lease keeps renewing until it returns. Children the run
              created keep working; only <C>stop</C> ends a child.
            </P>
          </Section>

          <Section id="heads" title="Heads">
            <P>
              A head is a name. <C>heads.move</C> defaults it to <C>main</C>; the other calls
              require one, and none takes the head lease. A parent or head the session does not list
              answers <C>unknown_parent</C> or <C>not_found</C>. <C>heads.delete</C> answers{" "}
              <C>busy</C> while the head lease is live, and the SDK throws for <C>main</C>.
            </P>
            <Table
              head={["Call", "One CAS", "Answers"]}
              rows={[
                [
                  <C key="0">heads.create</C>,
                  "Writes the head at the parent's tip and its stack. From a commit, the head alone.",
                  <Codes key="2" items={["created", "exists", "unknown_parent"]} />,
                ],
                [
                  <C key="0">heads.move</C>,
                  "Moves the head from the tip the call read.",
                  <Codes key="2" items={["moved", "moved_since", "not_found", "busy", "failed"]} />,
                ],
                [
                  <C key="0">heads.delete</C>,
                  "Deletes the head, its stack, both inbox deliveries and its run ref.",
                  <Codes key="2" items={["deleted", "not_found", "busy"]} />,
                ],
                [
                  <C key="0">heads.merge</C>,
                  "Moves the parent to the child's tip and the stack's base to the same tip.",
                  <Codes key="2" items={["merged", "stale", "empty", "no_stack"]} />,
                ],
              ]}
            />
            <H3>Moving a head</H3>
            <P>
              <C>heads.move</C> runs these checks in order, and the CAS at the end decides. If{" "}
              <C>expect</C> is set and the tip differs, the call answers <C>moved_since</C>. A run
              in any phase but <C>done</C>, <C>failed</C> or <C>aborted</C> answers <C>busy</C>, a
              parked run included. A target that is not a commit answers <C>not_found</C>. A message
              that lands between the checks and the CAS moves the tip, so the move answers{" "}
              <C>moved_since</C>.
            </P>
            <P>
              A user message target lands on its parent and comes back as <C>restored</C>, so the
              client can refill the composer. With <C>summary</C>, a model call writes one{" "}
              <C>summary</C> commit over the abandoned commits, parented on the landing target, and
              the head moves to it. With nothing abandoned the move stays plain. A failed call
              answers <C>failed</C> and leaves the head put.
            </P>
            <H3>Stacks</H3>
            <P>
              A stack holds the parent's name and a <C>base</C>, the parent's tip when the head was
              cut. A stacked head is stale when <C>base</C> differs from the parent's tip, and{" "}
              <C>heads.list</C> reports it. <C>heads.merge</C> answers <C>no_stack</C> without a
              stack, <C>stale</C> for a stale one, and <C>empty</C> when the child has no commit
              past <C>base</C>. It never answers <C>busy</C>. A run live on the parent loses its
              next publish and ends <C>aborted</C> with reason <C>superseded</C>.
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
              until <C>head_moved</C> shows the commit. A fenced or lost publish can leave deltas in
              the log with no commit behind them.
            </P>
            <P>
              A seq is a place in the log, not an event's identity, so a consumer must not drop an
              event because its seq repeats. The host-local events <C>activation_changed</C>,{" "}
              <C>plugins_changed</C>, <C>notification</C> and <C>status_changed</C> are stamped with
              the latest seq and are not in the log.
            </P>
          </Section>

          <Section id="plugins" title="Plugins">
            <P>
              Plugins load per session. Each registers tools, hooks and commands into its own scope,
              and disposing the scope undoes all of it. Every call into plugin code other than a
              tool runs under a wall-clock budget, and running out counts as a thrown error. A stop
              cancels a tool through the call's signal.
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
                  "Fails closed. This call and the rest of its batch get the policy's message as an error result.",
                ],
                [
                  <Codes
                    key="0"
                    items={[
                      "transform_context",
                      "transform_transcript",
                      "before_request",
                      "after_tool",
                      "cache_warming_decision",
                    ]}
                  />,
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
                ["disposer", "5 s", "Reported. The next disposer runs."],
              ]}
            />
            <P>
              Hooks run in plugin order. <C>before_tool</C> policies chain: <C>modify</C> hands new
              arguments to the next policy, <C>continue</C> objects to nothing, and the first{" "}
              <C>reject</C> or <C>error</C> ends the chain. A reload loads the new scope before it
              disposes the old one, so policy hooks never lapse. <C>setPlugins</C> answers{" "}
              <C>queued</C> while the session has an offered response, a run in <C>tools</C> or{" "}
              <C>waiting</C>, or a running command or listener, and the set publishes once they
              finish. File plugin ids are lowercase letters, digits and hyphens, and{" "}
              <C>subagents</C> and <C>jobs</C> are reserved.
            </P>
            <H3>Where plugins come from</H3>
            <P>
              A host passes <C>NyteOptions.plugins</C>, among them the providers that open
              workspaces. Its <C>trust</C> answer decides each workspace once, when it opens, as{" "}
              <C>trusted</C>, <C>inactive</C> or <C>requires</C>, and only a trusted workspace
              reaches its provider. Once the provider has opened the environment, the answer's{" "}
              <C>plugins</C> loader adds the project plugins, and it runs again before each
              response. Project plugins can wrap an environment but cannot provide one. Without a{" "}
              <C>trust</C> function, only <C>defaultWorkspace</C> is trusted.
            </P>
          </Section>

          <Section id="agents" title="Agents">
            <P>
              An agent preset is data from the <C>agents</C> registry: a model pin, a persona added
              to the base prompt, a tool allowlist and a <C>steps</C> ceiling. A run records the
              preset's name in <C>config.agent</C>.
            </P>
            <P>
              The <C>subagents</C> plugin gives a parent's model six tools: <C>task</C>,{" "}
              <C>create</C>, <C>send</C>, <C>await</C>, <C>read</C> and <C>stop</C>. Only root
              sessions get them, so depth is 1. A child's <C>parent</C> fact names the parent
              session, run and call. The child's id hashes those with the head, so a replayed{" "}
              <C>create</C> finds the child it already made. A child also loses every tool marked{" "}
              <C>availability: "foreground"</C>, because nobody is there to answer it. A child with
              no <C>model</C> tries <C>DEFAULT_TASK_MODELS</C> in order, and an explicit{" "}
              <C>model</C> never falls back.
            </P>
            <H3>A request and its answer</H3>
            <P>
              A parent and a child are two sessions, so no CAS spans them, and <C>send</C> orders
              its writes instead. It first writes the request record at{" "}
              <C>refs/delegations/&lt;child&gt;/&lt;change&gt;</C> in the parent's store, in a CAS
              that asserts the parent's run ref. A stop that moved that ref makes the write fail,
              and <C>send</C> abandons the request. Only then does the child's inbox tip move, with
              a <C>user</C> change, and a submit that fails removes the record.
            </P>
            <P>
              The record carries the authorization: <C>authorized</C> for a model's <C>send</C> or{" "}
              <C>task</C>, <C>input</C> for a message a person sends to the child. When the child's
              run for the request ends, <C>deliverDue</C> submits one <C>answer</C> to the parent
              head as <C>steer</C> under the key <C>delegate-&lt;child&gt;-&lt;change&gt;</C>, and
              then marks the record delivered. A crash between the two writes lands nothing twice,
              because the key answers <C>duplicate</C>.
            </P>
            <P>
              <C>await</C>, and <C>task</C> with <C>waitMs</C>, park the call with an <C>until</C>{" "}
              and no selection. <C>wakeWaits</C> signals it when the named children satisfy{" "}
              <C>any</C> or <C>all</C>, or when user input is queued on the parent's head, so the
              model can answer the user first.
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
              context is linear. There is no worktree; a client reads at any commit. The SDK carries
              a stale branch forward with a summary commit instead of rebasing. The event log can be
              trimmed, so a cursor can expire.
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
                when the transaction commits.
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
                ["oid", "The SHA-256 of the body."],
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
                [
                  "lease",
                  <>
                    An expiring lock on a name. A step, a compaction and a relocation hold{" "}
                    <C>refs/heads/&lt;head&gt;</C>, and a job holds <C>refs/jobs/&lt;job&gt;</C>.
                  </>,
                ],
                [
                  "fence",
                  <>
                    A lease's generation. Writes that carry an older fence answer <C>fenced</C>.
                    Renew and release match the owner and the fence, never the expiry, so a holder
                    past its expiry keeps its write rights until another host takes over.
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
              <C>next</C>
              {"\u00a0"}
              <Src path="names.ts" />, and the SDK's default head is <C>main</C>.
            </P>
            <Table
              head={["Ref", "Holds", "Written by"]}
              rows={REFS.map(([name, holds, writer]) => [<C key="0">{name}</C>, holds, writer])}
            />
          </Section>

          <Section id="objects" title="Objects">
            <P>
              A <C>Change</C> is a commit body waiting for its parent: a user message, a completion
              or a config. Landing turns it into a commit. The <C>Run</C> object is replaced on
              every phase change, so the run ref's history is the run's history. <C>done</C>,{" "}
              <C>failed</C> and <C>aborted</C> are terminal.
            </P>
            <Source title="Change and Run" excerpt={EXCERPTS.objects} />
            <Source title="RunPhase" excerpt={EXCERPTS.runPhase} />
            <Table
              head={["Body", "Reaches the model as"]}
              rows={[
                [
                  <C key="0">message</C>,
                  <Inline
                    key="1"
                    text="The message itself: user, assistant, tool result or `system`. An assistant message that ended `error`, `aborted` or `deferred` stays in history and is left out of context."
                  />,
                ],
                [<C key="0">completion</C>, "A user message holding the job's output."],
                [
                  <C key="0">checkpoint</C>,
                  "Its system message, its summary, then the retained tail.",
                ],
                [
                  <C key="0">summary</C>,
                  <Inline
                    key="1"
                    text="One user message with its text. `imports` names the abandoned commits and is never sent."
                  />,
                ],
                [
                  <C key="0">config</C>,
                  "Nothing. The newest value of each field sets the model, thinking level and agent.",
                ],
                [<C key="0">usage</C>, "Nothing. It bills a model call that wrote no message."],
              ]}
            />
            <P>
              Every commit records when it was written, and the run that wrote it when a runner did.
              Assistant <C>calls</C> and <C>outcome</C>, a tool result's <C>call</C> and <C>tree</C>
              , and <C>start</C> on the commit that opens a run are provenance: the runner stamps
              them, and the model never sees them.
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
