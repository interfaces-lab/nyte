/**
 * How a message travels from the kernel to the transcript, hop by hop, with
 * the file each hop lives in. Line numbers are from the tree this page was
 * written against; the names are the anchors.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";

type Verdict = "keeps" | "rewraps" | "round trip" | "twice" | "fixed";

interface Hop {
  readonly name: string;
  readonly where: string;
  readonly verdict: Verdict;
  readonly text: string;
}

interface Chain {
  readonly label: string;
  readonly steps: readonly { readonly name: string; readonly rewrap?: true }[];
}

const CHAINS: readonly Chain[] = [
  {
    label: "Settled",
    steps: [
      { name: "Commit" },
      { name: "transcriptFromCommits" },
      { name: "Turn[]" },
      { name: "SessionState" },
      { name: "snapshotOf → SessionSnapshot", rewrap: true },
      { name: "query cache" },
      { name: "TranscriptRow" },
      { name: "TranscriptDisplayPart", rewrap: true },
      { name: "StepEntry + presentation", rewrap: true },
      { name: "ToolCallView → leaf", rewrap: true },
    ],
  },
  {
    label: "Streaming",
    steps: [
      { name: "SessionEvent" },
      { name: "foldLiveParts" },
      { name: "LiveParts" },
      { name: "projectLive → LiveSnapshot", rewrap: true },
      { name: "LiveTurn | StepGroupView live prop", rewrap: true },
      { name: "createThinkingKey", rewrap: true },
    ],
  },
];

const SDK: readonly Hop[] = [
  {
    name: "Commit",
    where: "protocol/src/kernel.ts:150",
    verdict: "keeps",
    text: "The durable object. An assistant commit carries calls: Record<callId, ToolClass>; a tool result carries call: ToolClass and its settlement. The runner stamps ToolClass from the tool's typed arguments, so no client ever parses tool arguments.",
  },
  {
    name: "transcriptFromCommits / appendTranscriptCommit",
    where: "client/src/views/transcript.ts:499, :412",
    verdict: "keeps",
    text: "One projection. Core runs it to answer sessions.snapshot (core/src/kernel/sdk/reads.ts:319) and messages.list (nyte.ts:508); the client runs the incremental form for each commit event. Both arrive at the same Turn[].",
  },
  {
    name: "Turn · TurnPart · ToolTurnPart",
    where: "protocol/src/views.ts:27–103",
    verdict: "keeps",
    text: "user | assistant | thinking | tool. A tool part is { callId, class, state, output }. ToolState already says pending, running, needs input, success, or error with its reason. Turn.failure says why the response stopped.",
  },
  {
    name: "SessionEvent → SessionObserver → SessionState",
    where:
      "protocol/src/sdk.ts:415 · client/src/session/session-follow.ts:105 · session-state.ts:51",
    verdict: "keeps",
    text: "The observer takes a snapshot, then folds events: commit appends to the transcript, text_delta / reasoning_delta / tool_progress fold into the overlay (LiveParts, live-parts.ts:3), run and pending replace their fields.",
  },
];

const APP: readonly Hop[] = [
  {
    name: "SessionState → snapshotOf → SessionSnapshot",
    where: "client/src/session/session-state.ts:119, :139 · app/src/live.ts:108, :122",
    verdict: "round trip",
    text: "stateFromSnapshot unpacks the snapshot into SessionState; snapshotOf packs it back. LiveStore.update writes snapshotOf(state) into the query cache on every durable change, and getFrame builds a second copy for frame readers. The screen reads its transcript back out of that cache with useSessionSnapshot.",
  },
  {
    name: "LiveParts → projectLive → LiveSnapshot",
    where: "app/src/live-fold.ts:139",
    verdict: "round trip",
    text: "The client hands over one ordered array of parts. The app splits it into text, thinking and tools maps plus an order list with the text removed (LivePartRef). LiveTurn (live-turn.tsx:84) and StepGroupView (step-group.tsx:271) join text back by key. There are two livePartKey functions with different spellings: client/src/views/live-parts.ts:31 and app/src/live-fold.ts:49.",
  },
  {
    name: "Live and settled render through two paths",
    where: "app/src/conversation/live-turn.tsx:47 · step-group.tsx:69, :271, :304",
    verdict: "twice",
    text: "Settled work arrives as TurnParts; streaming work arrives as LivePartRefs and map lookups, drawn by LiveTurn or by the live prop threaded into the trailing StepGroupView. Settled thoughts are merged in one pass and live thoughts in another. createThinkingKey exists only to match a streaming thought to its settled self so React keeps the row.",
  },
  {
    name: "transcriptRows → TranscriptRow",
    where: "app/src/conversation/transcript-rows.ts:157",
    verdict: "keeps",
    text: "Virtualizer rows: a landing prompt and the turn it commits into share one key, requestless turns ride under their prompt as continuations, config turns drop out. This one earns its keep: the key is why the transcript holds still when a commit lands.",
  },
  {
    name: "displayTranscriptParts",
    where: "app/src/screens/thread.tsx:464 · conversation/turn-view.tsx:599, :616",
    verdict: "twice",
    text: "Regroups a turn's parts into part | step | response. The thread runs it on the last turn to decide settledWork, and TurnBody runs it again on every turn. TurnBody then unwraps a settled one-call step back into the part it wrapped.",
  },
  {
    name: "StepEntry → durable → live presentation",
    where: "app/src/conversation/step-group.tsx:46 · step-group-presentation.ts:207, :235",
    verdict: "rewraps",
    text: "Step parts become StepEntry rows, then a DurableStepGroupPresentation, then a live presentation that overlays the verb. Three shapes between the parts and the summary line.",
  },
  {
    name: "ToolCallView → ShellCallView | EditCallView | ToolLineView",
    where:
      "app/src/conversation/tool-call.tsx:132–190 · shell-call.tsx:373 · edit-call.tsx:229 · tool-line.tsx:214",
    verdict: "twice",
    text: "ToolCallView computes toolStatus, terminalText(output) and parsePatchFacts before it knows which leaf draws the call, then passes part and toolClass, the same data twice. Each leaf computes status and output again; EditCallView parses the patch a second time.",
  },
  {
    name: "Tool call density",
    where: "app/src/conversation/timeline.tsx · turn-view.tsx · live-turn.tsx",
    verdict: "fixed",
    text: "Timeline, TurnBody and LiveTurn each read the global preference. Now Timeline reads it once and passes it down as a prop. That is also what lets this page draw three densities side by side.",
  },
];

const DELETIONS: readonly string[] = [
  "One path for live and settled. Let the client project the overlay into provisional TurnParts on the trailing turn, same union with a provisional flag. LiveSnapshot, LivePartRef, the second livePartKey, LiveTurn's own group, the live prop and createThinkingKey go away, and TurnView draws everything.",
  "Read SessionState, or a snapshot the observer owns, instead of rebuilding SessionSnapshot with snapshotOf for the cache and again for the frame.",
  "Switch on class.kind first in ToolCallView and let each leaf derive what it draws once. Drop the duplicate toolClass prop and the second patch parse.",
];

const VERDICT = {
  keeps: undefined,
  rewraps: intent.primary,
  "round trip": intent.warning,
  twice: intent.warning,
  fixed: intent.success,
} as const satisfies Record<Verdict, (typeof intent)[keyof typeof intent] | undefined>;

function HopList({ hops }: { readonly hops: readonly Hop[] }): ReactElement {
  return (
    <ol {...props(styles.hops)}>
      {hops.map((hop) => (
        <li key={hop.name} {...props(styles.hop)}>
          <span {...props(VERDICT[hop.verdict], styles.verdict)}>{hop.verdict}</span>
          <div {...props(styles.hopBody)}>
            <code {...props(styles.hopName)}>{hop.name}</code>
            <span {...props(styles.where)}>{hop.where}</span>
            <p {...props(styles.text)}>{hop.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Wiring(): ReactElement {
  return (
    <article {...props(styles.root)}>
      <section aria-labelledby="wiring-chains" {...props(styles.section)}>
        <h2 id="wiring-chains" {...props(styles.heading)}>
          The two paths
        </h2>
        <p {...props(styles.lede)}>
          A settled message and a streaming one take different routes to the same rows. Outlined
          steps unwrap a shape the step before already had and wrap it into another.
        </p>
        {CHAINS.map((chain) => (
          <div key={chain.label} {...props(styles.chain)}>
            <span {...props(styles.chainLabel)}>{chain.label}</span>
            <ol {...props(styles.steps)}>
              {chain.steps.map((step, index) => (
                <li key={step.name} {...props(styles.stepItem)}>
                  {index > 0 && (
                    <span aria-hidden="true" {...props(styles.arrow)}>
                      →
                    </span>
                  )}
                  <code
                    {...props(
                      step.rewrap === true && intent.warning,
                      styles.step,
                      step.rewrap === true && styles.rewrap,
                    )}
                  >
                    {step.name}
                  </code>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
      <section aria-labelledby="wiring-sdk" {...props(styles.section)}>
        <h2 id="wiring-sdk" {...props(styles.heading)}>
          What the SDK answers
        </h2>
        <p {...props(styles.lede)}>
          Everything the transcript needs is already typed when it leaves the client package: what
          each tool is, how it settled, why a turn failed.
        </p>
        <HopList hops={SDK} />
      </section>
      <section aria-labelledby="wiring-app" {...props(styles.section)}>
        <h2 id="wiring-app" {...props(styles.heading)}>
          What the app does with it
        </h2>
        <HopList hops={APP} />
      </section>
      <section aria-labelledby="wiring-delete" {...props(styles.section)}>
        <h2 id="wiring-delete" {...props(styles.heading)}>
          What to delete, in order
        </h2>
        <ol {...props(styles.deletions)}>
          {DELETIONS.map((text) => (
            <li key={text} {...props(styles.text)}>
              {text}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

const styles = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 40,
    maxWidth: 960,
  },
  section: { display: "flex", flexDirection: "column", gap: 12 },
  heading: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 600,
  },
  lede: {
    margin: 0,
    maxWidth: "68ch",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  chain: {
    display: "grid",
    gridTemplateColumns: "80px minmax(0, 1fr)",
    alignItems: "baseline",
    gap: 12,
  },
  chainLabel: {
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 500,
  },
  steps: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 8,
    columnGap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  stepItem: { display: "flex", alignItems: "center", gap: 6 },
  arrow: { color: role.contentTertiary, fontSize: type.fontXs },
  step: {
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    whiteSpace: "nowrap",
  },
  rewrap: {
    color: role.contentSecondary,
    boxShadow: `inset 0 0 0 1px ${role.borderStrongTranslucent}`,
  },
  hops: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  hop: {
    display: "grid",
    gridTemplateColumns: "80px minmax(0, 1fr)",
    alignItems: "baseline",
    gap: 12,
  },
  verdict: {
    justifySelf: "start",
    paddingBlock: 1,
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  hopBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  hopName: {
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  where: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    overflowWrap: "anywhere",
  },
  text: {
    margin: 0,
    marginTop: 4,
    maxWidth: "72ch",
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  deletions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    paddingInlineStart: 20,
  },
});
