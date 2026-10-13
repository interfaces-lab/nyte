/**
 * How a message travels from the kernel to the transcript, hop by hop, with
 * the file each hop lives in. The names are the anchors.
 */
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";

type Verdict = "keeps" | "rewraps" | "twice" | "fixed";

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
    label: "View",
    steps: [
      { name: "SessionView" },
      { name: "conversationTurns" },
      { name: "ConversationTurn" },
      { name: "TranscriptRow" },
      { name: "displayTranscriptParts", rewrap: true },
      { name: "StepGroupView + presentation", rewrap: true },
      { name: "ToolCallView → leaf" },
    ],
  },
];

const SDK: readonly Hop[] = [
  {
    name: "Message",
    where: "schema/src/views.ts",
    verdict: "keeps",
    text: "A user input or a part, nothing else. One id from admission to commit, so a streaming part and its committed self are the same message; status says live, waiting, settled or failed.",
  },
  {
    name: "TurnInfo",
    where: "schema/src/views.ts",
    verdict: "keeps",
    text: "The turn's run, prompt, state and step count, plus a summary the fold keeps as tools settle. A turn whose prompt is null is a continuation a background report opened. A failed end carries the failure.",
  },
  {
    name: "ToolPartState",
    where: "schema/src/parts.ts · tools.ts",
    verdict: "keeps",
    text: "The call, its typed ToolClass, and a phase: calling, running with progress, or settled with an outcome and the file changes. The runner stamps the class, so no client parses tool arguments.",
  },
  {
    name: "Execution",
    where: "schema/src/runs.ts",
    verdict: "keeps",
    text: "The one place a head's run phase lives: idle with how the last run ended, live, waiting, or retrying with a reason.",
  },
];

const APP: readonly Hop[] = [
  {
    name: "Live and settled render through one path",
    where: "app/src/conversation/turn-view.tsx · live-turn.tsx",
    verdict: "fixed",
    text: "The view carries streaming parts as messages, so TurnView draws everything. LiveTurn only holds the indicator before the first part of a run arrives.",
  },
  {
    name: "conversationTurns → ConversationTurn",
    where: "app/src/view-helpers.ts",
    verdict: "keeps",
    text: "Groups the view's messages under its turns in one pass. Messages whose turn is not listed yet come back apart, for the landing rows and the tray.",
  },
  {
    name: "transcriptRows → TranscriptRow",
    where: "app/src/conversation/transcript-rows.ts",
    verdict: "keeps",
    text: "Virtualizer rows: a landing prompt and the turn it commits into share one key, and requestless turns ride under their prompt as continuations. The key is why the transcript holds still when a commit lands.",
  },
  {
    name: "displayTranscriptParts",
    where: "app/src/screens/thread.tsx · conversation/turn-view.tsx",
    verdict: "twice",
    text: "Regroups a turn's messages into part | step | response. The thread runs it on the last turn to decide settledWork, and TurnBody runs it again on every turn. TurnBody then unwraps a settled one-call step back into the call it wrapped.",
  },
  {
    name: "Step messages → durable → live presentation",
    where: "app/src/conversation/step-group.tsx · step-group-presentation.ts",
    verdict: "rewraps",
    text: "Step messages become a durable presentation, then a live presentation that overlays the verb. Two shapes between the messages and the summary line.",
  },
  {
    name: "ToolCallView → ShellCallView | EditCallView | ToolLineView",
    where: "app/src/conversation/tool-call.tsx · shell-call.tsx · edit-call.tsx · tool-line.tsx",
    verdict: "twice",
    text: "ToolCallView computes toolStatus and the terminal text before it switches on class.kind; each leaf computes status and output again.",
  },
  {
    name: "Tool call density",
    where: "app/src/conversation/timeline.tsx · turn-view.tsx · live-turn.tsx",
    verdict: "fixed",
    text: "Timeline reads the preference once and passes it down as a prop. That is also what lets this page draw three densities side by side.",
  },
];

const DELETIONS: readonly string[] = [
  "Decide settledWork from the grouping TurnBody already computes instead of running displayTranscriptParts twice.",
  "Let each ToolCallView leaf derive status and output once, after the switch on class.kind.",
];

const VERDICT = {
  keeps: undefined,
  rewraps: intent.primary,
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
          The path
        </h2>
        <p {...props(styles.lede)}>
          Settled and streaming messages take the same route to the rows. Outlined steps unwrap a
          shape the step before already had and wrap it into another.
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
          Everything the transcript needs is already typed when it leaves the SDK: what each tool
          is, how it settled, why a turn failed.
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
