import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Spinner } from "@nyte-ai/ui/spinner";
import { input, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { Activity } from "./activity.tsx";
import { editable } from "./composer.tsx";
import { MODELS } from "./model.ts";
import type { Answer, Item, Stack } from "./model.ts";
import {
  CheckDots,
  Header,
  PersonLabel,
  Properties,
  StatusGlyph,
  Tile,
  ago,
  checkSummary,
} from "./parts.tsx";
import { pane } from "./stack-view.tsx";

const COMPACT = "@container stacks (max-width: 959px)";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  split: {
    display: { default: "grid", [COMPACT]: "flex" },
    flexDirection: "column",
    gridTemplateColumns: "minmax(300px, 380px) minmax(0, 1fr)",
    flex: 1,
    minHeight: 0,
    overflowY: { default: "visible", [COMPACT]: "auto" },
  },
  left: {
    display: { default: "flex", [COMPACT]: "contents" },
    flexDirection: "column",
    gap: space.s6,
    minHeight: 0,
    overflowY: "auto",
    padding: space.s8,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: role.borderSecondaryTranslucent,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingInline: { default: 0, [COMPACT]: space.s8, [NARROW]: space.s4 },
    paddingBlock: { default: 0, [COMPACT]: space.s6, [NARROW]: space.s5 },
  },
  heroText: { display: "flex", flexDirection: "column", gap: space.s1 },
  facts: {
    order: { default: 0, [COMPACT]: 2 },
    paddingInline: { default: 0, [COMPACT]: space.s8, [NARROW]: space.s4 },
    paddingBlock: { default: 0, [COMPACT]: space.s6 },
    borderBlockStartWidth: { default: 0, [COMPACT]: 1 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  right: {
    order: { default: 0, [COMPACT]: 1 },
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: { default: 0, [COMPACT]: "auto" },
  },
  timeline: {
    flex: 1,
    minHeight: 0,
    overflowY: { default: "auto", [COMPACT]: "visible" },
    paddingInline: { default: space.s8, [NARROW]: space.s4 },
    paddingBlock: { default: space.s8, [COMPACT]: space.s2 },
  },
  timelineInner: { maxWidth: 720 },
  question: {
    margin: 0,
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
    textWrap: "pretty",
  },
  kept: { color: role.contentSecondary, fontWeight: type.weightRegular },
  answers: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  answerHint: {
    display: { default: "inline-flex", [NARROW]: "none" },
    color: role.contentTertiary,
  },
  live: { display: "flex", alignItems: "center", gap: space.s2, color: role.contentSecondary },
  mono: { fontFamily: type.fontMono, fontSize: type.fontSm, color: role.contentSecondary },
  quiet: { color: role.contentSecondary },
  state: { color: role.contentTertiary },
  reply: {
    position: { default: "static", [COMPACT]: "sticky" },
    insetBlockEnd: space.s3,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    marginInline: { default: space.s8, [NARROW]: space.s3 },
    marginBlockEnd: { default: space.s4, [NARROW]: space.s3 },
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s1_5,
    paddingBlock: space.s1_5,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: {
      default: shadow.shadowMdOutline,
      ":focus-within": `${shadow.shadowMdOutline}, 0 0 0 1px ${role.borderStrongTranslucent}`,
    },
    flexShrink: 0,
  },
  replyInput: {
    flex: 1,
    minWidth: 0,
    height: input.heightMd,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: role.contentPrimary,
    fontFamily: "inherit",
    outline: "none",
    "::placeholder": { color: role.contentTertiary },
  },
});

/**
 * Interfere's problem page: what it is on the left, what happened on the right. Everything that
 * happened, every screenshot and every question is one timeline; you reply to the lead under it.
 */
export function ItemView({
  stack,
  item,
  clock,
  onBack,
  onAnswer,
  onReply,
  onKeep,
  onStop,
}: {
  readonly stack: Stack;
  readonly item: Item;
  readonly clock: number;
  readonly onBack: () => void;
  readonly onAnswer: (answer: Answer) => void;
  readonly onReply: (text: string) => void;
  readonly onKeep: (finding: string) => void;
  readonly onStop: () => void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const reply = useRef<HTMLInputElement | null>(null);
  const spent = item.sessions.reduce((sum, entry) => sum + entry.cost, 0);
  const number = item.number === null ? null : `#${String(item.number)}`;
  const finished = item.status === "merged" || item.status === "done";
  const kept = item.findings.filter((finding) => finding.kept).length;
  const primary = item.ask?.answers.find((answer) => answer.primary);
  const added = item.files.reduce((sum, file) => sum + file.added, 0);
  const removed = item.files.reduce((sum, file) => sum + file.removed, 0);

  const answer = (chosen: Answer): void => {
    onAnswer(chosen);

    if (chosen.status === "working") reply.current?.focus();
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && event.metaKey && primary !== undefined) {
      event.preventDefault();
      answer(primary);

      return;
    }

    if (event.key === "Escape" && !editable(event.target)) onBack();
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey(event);

    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <section aria-label={item.title} {...props(pane.pane)}>
      <Header
        trail={[
          { label: "Stacks" },
          { label: stack.name, onClick: onBack },
          { label: number === null ? item.title : `${number} ${item.title}` },
        ]}
        actions={
          !finished && (
            <Menu>
              <MenuTrigger
                render={
                  <Button size="sm" iconOnly icon="more-horizontal" aria-label="Item Actions" />
                }
              />
              <MenuContent align="end">
                <MenuItem icon="square" onClick={onStop}>
                  Stop and Keep the Branch
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      />
      <div {...props(styles.split)}>
        <div {...props(styles.left)}>
          <div {...props(styles.hero)}>
            <Tile surface={item.surface} size="lg" />
            <div {...props(styles.heroText)}>
              {number !== null && <span {...props(text.sm, pane.number)}>{number}</span>}
              <h1 {...props(pane.title)}>{item.title}</h1>
            </div>
            <p {...props(text.base, pane.summary)}>{item.summary}</p>
          </div>
          <div {...props(styles.facts)}>
            <Properties
              rows={[
                {
                  label: "Status",
                  value: (
                    <>
                      <StatusGlyph status={item.status} />
                      {item.now}
                    </>
                  ),
                },
                {
                  label: "Pull request",
                  value:
                    number === null ? (
                      <span {...props(styles.quiet)}>Opens after review</span>
                    ) : (
                      <>
                        <Icon name="pull-request" size={14} />
                        {number}
                      </>
                    ),
                },
                { label: "Branch", value: <span {...props(styles.mono)}>{item.branch}</span> },
                { label: "Author", value: <PersonLabel person={item.author} /> },
                ...item.sessions.map((session) => ({
                  label: session.lead ? `${session.name} (lead)` : session.name,
                  value: (
                    <>
                      <Icon name={MODELS[session.model].icon} size={14} />
                      {MODELS[session.model].name}
                      <span {...props(styles.state)}>{session.state}</span>
                    </>
                  ),
                })),
                {
                  label: "Checks",
                  value:
                    item.checks.length === 0 ? (
                      <span {...props(styles.quiet)}>Not run yet</span>
                    ) : (
                      <>
                        <CheckDots checks={item.checks} />
                        {checkSummary(item.checks)}
                      </>
                    ),
                },
                {
                  label: "Changes",
                  value:
                    item.files.length === 0 ? (
                      <span {...props(styles.quiet)}>None yet</span>
                    ) : (
                      `${String(item.files.length)} ${item.files.length === 1 ? "file" : "files"}, +${String(added)} −${String(removed)}`
                    ),
                },
                {
                  label: "Surface",
                  value: (
                    <>
                      <Tile surface={item.surface} size="sm" />
                      {item.surface.name}
                    </>
                  ),
                },
                { label: "Updated", value: ago(item.updated, clock) },
                { label: "Spent", value: `$${spent.toFixed(2)}` },
              ]}
            />
          </div>
        </div>
        <div {...props(styles.right)}>
          <div {...props(styles.timeline)}>
            <div {...props(styles.timelineInner)}>
              <Activity
                events={item.activity}
                clock={clock}
                findings={item.findings}
                canKeep={item.ask !== null}
                onKeep={onKeep}
                tail={
                  item.ask !== null ? (
                    <>
                      <p {...props(text.base, styles.question)}>
                        {item.ask.question}
                        {item.findings.length > 0 && (
                          <span {...props(styles.kept)}>
                            {" "}
                            {kept} of {item.findings.length} kept.
                          </span>
                        )}
                      </p>
                      <div {...props(styles.answers)}>
                        {item.ask.answers.map((entry) => (
                          <Button
                            key={entry.label}
                            size="sm"
                            variant={entry.primary ? "solid" : "outline"}
                            tone={entry.primary ? "primary" : "neutral"}
                            onClick={() => answer(entry)}
                          >
                            {entry.label}
                          </Button>
                        ))}
                        {primary !== undefined && (
                          <span {...props(styles.answerHint)}>
                            <Kbd keys={["⌘", "↵"]} />
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    !finished &&
                    item.script.length > 0 && (
                      <span {...props(text.sm, styles.live)}>
                        <Spinner />
                        {item.now}
                      </span>
                    )
                  )
                }
              />
            </div>
          </div>
          {!finished && (
            <form
              aria-label="Reply"
              onSubmit={(event) => {
                event.preventDefault();

                if (draft.trim() === "") return;
                onReply(draft.trim());
                setDraft("");
              }}
              {...props(styles.reply)}
            >
              <input
                ref={reply}
                aria-label={`Reply to ${stack.name}`}
                placeholder={`Reply to ${stack.name}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.currentTarget.blur();
                }}
                {...props(text.base, styles.replyInput)}
              />
              <Button
                type="submit"
                variant="solid"
                tone="primary"
                size="xs"
                iconOnly
                icon="arrow-up"
                aria-label="Send Reply"
                disabled={draft.trim() === ""}
              />
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
