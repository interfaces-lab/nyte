import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import type { Ask, Chat } from "./chats.ts";
import type { Lane } from "./lane.ts";
import { styles } from "./page.stylex";
import type { Prompt } from "./prompts.ts";
import { StatusGlyph } from "./sidebar.tsx";
import type { Unit } from "./view.ts";

export interface Next {
  readonly text: string;
  readonly label: string;
  readonly run: () => void;
}

export interface Answer {
  readonly label: string;
  readonly run: () => void;
}

export function unitLine(unit: Unit): string {
  switch (unit.status) {
    case "needs-you":
      return "Waiting on you";
    case "failing":
      return `Failing ${unit.pull?.failing.join(", ") ?? ""}`.trim();
    case "working":
      return unit.kind === "base" ? `Fixing main: ${unit.why}` : "Being fixed";
    case "watching":
      return unit.pull?.routed === null || unit.pull === null
        ? "Checks running"
        : "Waiting on a fix to main";
    case "ready":
      return "Ready to merge";
    case "idle":
      return unit.kind === "base" ? "Main is fixed" : "Open";
    case "merged":
      return "Merged";
    default: {
      const _exhaustive: never = unit.status;

      return _exhaustive;
    }
  }
}

export function chatLine(chat: Chat): string {
  const lead = chat.units.find((unit) => unit.status === chat.status) ?? chat.units[0];

  if (lead === undefined) return "Nothing in flight";
  const line = chat.ask?.kind === "rebase" ? "Rebase onto main?" : unitLine(lead);

  return chat.units.length === 1 ? line : `${String(chat.units.length)} pull requests · ${line}`;
}

function Pane({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} {...props(styles.pane)}>
      <header {...props(styles.paneHeader)}>
        <h1 {...props(styles.paneTitle)}>{title}</h1>
        {meta !== undefined && <span {...props(styles.paneMeta)}>{meta}</span>}
      </header>
      <div {...props(styles.scroller)}>
        <div {...props(styles.body)}>{children}</div>
      </div>
    </section>
  );
}

function Question({
  ask,
  answer,
}: {
  readonly ask: Ask;
  readonly answer: Answer | null;
}): ReactElement {
  return (
    <div role="group" aria-label="Question for you" {...props(styles.question)}>
      <p {...props(styles.questionText)}>{ask.question}</p>
      {answer !== null && (
        <div>
          <Button variant="solid" tone="primary" size="sm" onClick={answer.run}>
            {answer.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function NextLine({ next }: { readonly next: Next | null }): ReactElement | null {
  if (next === null) return null;

  return (
    <div {...props(styles.next)}>
      <span {...props(styles.quiet)}>{next.text}</span>
      <Button size="sm" onClick={next.run}>
        {next.label}
      </Button>
    </div>
  );
}

function Sent({ prompts }: { readonly prompts: readonly Prompt[] }): ReactElement | null {
  if (prompts.length === 0) return null;

  return (
    <details {...props(styles.details)}>
      <summary {...props(styles.summary)}>What Polish sent</summary>
      <div {...props(styles.detailsBody)}>
        {prompts.map((prompt) => (
          <div key={prompt.id} {...props(styles.sent)}>
            <span {...props(styles.quiet)}>
              {prompt.title}
              {prompt.model === null ? "" : `, on ${prompt.model}`}
            </span>
            <pre {...props(styles.prompt)}>{prompt.text}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function Rules({ lane }: { readonly lane: Lane }): ReactElement {
  const rules = lane.rules;

  const role = (rule: Lane["rules"]["roles"]["worker"]): string =>
    `${rule.model.provider}/${rule.model.id}, thinking ${rule.model.thinking}${rule.skills.length === 0 ? "" : `, reads ${rule.skills.map((skill) => skill.name).join(", ")}`}`;

  const entries: readonly (readonly [string, string])[] = [
    ["Writes", role(rules.roles.worker)],
    ["Reviews, commits, opens the PR", role(rules.roles.reviewer)],
    ["Watches CI", role(rules.roles.babysitter)],
    ["Works in", `its own worktree from ${rules.checkout.from}, nothing copied in`],
    ["Gate", rules.pullRequest.gate.join(" and ")],
    ["Never", rules.never.join("; ")],
    ["Asks you", "before merging or rebasing"],
    [
      "Limits",
      `${String(rules.limits.workers)} fixes at once, $${rules.limits.perPullRequest.usd.toFixed(2)} and ${String(rules.limits.perPullRequest.attempts)} tries per pull request, $${String(rules.limits.dailyUsd)} a day`,
    ],
  ];

  return (
    <details {...props(styles.details)}>
      <summary {...props(styles.summary)}>How Polish works</summary>
      <dl {...props(styles.facts, styles.detailsBody)}>
        {entries.map(([label, value]) => (
          <div key={label} {...props(styles.factRow)}>
            <dt {...props(styles.factLabel)}>{label}</dt>
            <dd {...props(styles.factValue)}>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ItemRow({
  glyph,
  title,
  line,
  onOpen,
}: {
  readonly glyph: ReactNode;
  readonly title: string;
  readonly line: string;
  readonly onOpen: (() => void) | undefined;
}): ReactElement {
  const body = (
    <>
      <span {...props(styles.itemGlyph)}>{glyph}</span>
      <span {...props(styles.itemTitle)}>{title}</span>
      <span {...props(styles.itemLine)}>{line}</span>
    </>
  );

  if (onOpen === undefined) return <li {...props(styles.item)}>{body}</li>;

  return (
    <li>
      <button type="button" onClick={onOpen} {...props(styles.item, styles.itemButton)}>
        {body}
      </button>
    </li>
  );
}

export function LaneTab({
  lane,
  chats,
  asks,
  answer,
  happened,
  next,
  empty,
  prompts,
  onOpen,
}: {
  readonly lane: Lane;
  readonly chats: readonly Chat[];
  readonly asks: readonly Ask[];
  readonly answer: (ask: Ask) => Answer | null;
  readonly happened: string | null;
  readonly next: Next | null;
  readonly empty: string;
  readonly prompts: readonly Prompt[];
  readonly onOpen: (chat: string) => void;
}): ReactElement {
  return (
    <Pane title={lane.name} meta="Stack">
      <p {...props(styles.lead)}>{lane.intent}</p>
      {happened !== null && <p {...props(styles.happened)}>{happened}</p>}
      {asks.map((ask) => (
        <Question key={ask.key} ask={ask} answer={answer(ask)} />
      ))}
      {chats.length === 0 ? (
        <p {...props(styles.quiet)}>{empty}</p>
      ) : (
        <ul aria-label={`Chats in ${lane.name}`} {...props(styles.items)}>
          {chats.map((chat) => (
            <ItemRow
              key={chat.id}
              glyph={<StatusGlyph status={chat.status} />}
              title={chat.title}
              line={chatLine(chat)}
              onOpen={() => onOpen(chat.id)}
            />
          ))}
        </ul>
      )}
      <NextLine next={next} />
      <Rules lane={lane} />
      <Sent prompts={prompts} />
    </Pane>
  );
}

export function ChatTab({
  chat,
  inLane,
  answer,
  happened,
  next,
  move,
  prompts,
}: {
  readonly chat: Chat;
  readonly inLane: boolean;
  readonly answer: (ask: Ask) => Answer | null;
  readonly happened: string | null;
  readonly next: Next | null;
  readonly move: (() => void) | undefined;
  readonly prompts: readonly Prompt[];
}): ReactElement {
  const sitters = chat.units.flatMap((unit) =>
    unit.chain.filter((link) => link.role === "babysitter"),
  );

  const model = sitters[0]?.model ?? null;

  return (
    <Pane title={chat.title} meta={inLane ? "In Polish" : (chat.model ?? undefined)}>
      {inLane && happened !== null && <p {...props(styles.happened)}>{happened}</p>}
      {!inLane && move !== undefined && (
        <div role="group" aria-label="Add to Polish" {...props(styles.question)}>
          <p {...props(styles.questionText)}>
            Polish can carry this chat&apos;s pull requests from here: it watches CI, fixes what is
            theirs, and asks you only to merge.
          </p>
          <div>
            <Button variant="solid" tone="primary" size="sm" icon="layers" onClick={move}>
              Add to Polish
            </Button>
          </div>
        </div>
      )}
      {chat.ask !== null && <Question ask={chat.ask} answer={answer(chat.ask)} />}
      {chat.units.length === 0 ? (
        <p {...props(styles.quiet)}>Nothing in flight.</p>
      ) : (
        <ul aria-label="In flight" {...props(styles.items)}>
          {chat.units.map((unit) => (
            <ItemRow
              key={unit.id}
              glyph={<StatusGlyph status={unit.status} />}
              title={unit.pull === null ? unit.title : `#${String(unit.pull.number)} ${unit.title}`}
              line={unitLine(unit)}
              onOpen={undefined}
            />
          ))}
        </ul>
      )}
      {sitters.length > 0 && (
        <p {...props(styles.quiet)}>
          A babysitter watches each pull request{model === null ? "" : `, on ${model}`}.
        </p>
      )}
      {inLane && <NextLine next={next} />}
      <Sent prompts={prompts} />
    </Pane>
  );
}
