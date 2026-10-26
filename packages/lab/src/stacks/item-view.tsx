import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { button, input, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Spinner } from "@nyte-ai/ui/spinner";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { Activity, Checks, Images } from "./activity.tsx";
import { editable } from "./composer.tsx";
import { DUTIES, MODELS } from "./model.ts";
import type { Answer, Item, Session, Stack } from "./model.ts";
import {
  CheckDots,
  Header,
  ModelLabel,
  PersonLabel,
  Properties,
  StatusGlyph,
  Tile,
  ago,
  checkSummary,
  styles as parts,
} from "./parts.tsx";
import { Shot } from "./shots.tsx";
import { pane } from "./stack-view.tsx";

const COMPACT = "@container stacks (max-width: 959px)";

const NARROW = "@container stacks (max-width: 639px)";

type Panel = "findings" | "preview" | "activity" | "sessions" | "changes";

const styles = create({
  split: {
    display: { default: "grid", [COMPACT]: "flex" },
    flexDirection: "column",
    gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)",
    flex: 1,
    minHeight: 0,
    overflowY: { default: "visible", [COMPACT]: "auto" },
  },
  left: {
    display: { default: "flex", [COMPACT]: "contents" },
    flexDirection: "column",
    gap: { default: space.s6, [NARROW]: space.s5 },
    flexShrink: 0,
    minHeight: 0,
    overflowY: { default: "auto", [COMPACT]: "visible" },
    padding: { default: space.s8, [NARROW]: space.s4 },
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderWidth: 0,
    borderInlineEndWidth: { default: 1, [COMPACT]: 0 },
    borderBlockEndWidth: { default: 0, [COMPACT]: 1 },
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingInline: { default: 0, [COMPACT]: space.s8, [NARROW]: space.s4 },
    paddingBlockStart: { default: 0, [COMPACT]: space.s6, [NARROW]: space.s5 },
    paddingBlockEnd: { default: 0, [COMPACT]: space.s5 },
  },
  facts: {
    order: { default: 0, [COMPACT]: 2 },
    paddingInline: { default: 0, [COMPACT]: space.s8, [NARROW]: space.s4 },
    paddingBlock: { default: 0, [COMPACT]: space.s6 },
    borderBlockStartWidth: { default: 0, [COMPACT]: 1 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
  },
  heroText: { display: "flex", flexDirection: "column", gap: space.s1 },
  right: {
    order: { default: 0, [COMPACT]: 1 },
    display: "flex",
    flexDirection: "column",
    flex: { default: "initial", [COMPACT]: "1 0 auto" },
    minWidth: 0,
    minHeight: { default: 0, [COMPACT]: "auto" },
  },
  fill: { flex: { default: 1, [COMPACT]: "1 0 auto" } },
  tabs: {
    borderBlockStartWidth: { default: 0, [COMPACT]: 1 },
    borderBlockStartStyle: "solid",
    borderBlockStartColor: role.borderSecondaryTranslucent,
    position: { default: "static", [COMPACT]: "sticky" },
    insetBlockStart: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    overflowX: "auto",
    scrollbarWidth: "none",
    paddingInline: { default: space.s4, [NARROW]: space.s3 },
    paddingBlock: space.s2,
    backgroundColor: role.bgBase,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
    flexShrink: 0,
  },
  tab: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    height: button.heightMd,
    paddingInline: space.s3,
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": role.bgHover,
      "[data-active]": role.bgMuted,
    },
    boxShadow: {
      default: "none",
      "[data-active]": `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    },
    color: { default: role.contentSecondary, "[data-active]": role.contentPrimary },
    fontFamily: "inherit",
    cursor: "pointer",
    transitionProperty: "background-color, color",
    transitionDuration: motion.durationFast,
  },
  panel: {
    flex: { default: 1, [COMPACT]: "1 0 auto" },
    minHeight: { default: 0, [COMPACT]: 240 },
    overflowY: { default: "auto", [COMPACT]: "visible" },
    padding: { default: space.s6, [NARROW]: space.s4 },
    outline: "none",
  },
  panelInner: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: 720 },
  ask: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    marginInline: { default: 0, [COMPACT]: space.s8, [NARROW]: space.s4 },
    marginBlockEnd: { default: 0, [COMPACT]: space.s5 },
    padding: space.s4,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
  },
  question: { display: "flex", gap: space.s2, margin: 0, textWrap: "pretty" },
  questionGlyph: {
    display: "inline-flex",
    paddingBlockStart: 2,
    color: role.contentInteractivePrimary,
  },
  answers: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  keyHint: { display: { default: "inline-flex", [NARROW]: "none" } },
  answerHint: {
    display: { default: "inline-flex", [NARROW]: "none" },
    marginInlineStart: "auto",
    color: role.contentTertiary,
  },
  tabCount: {
    marginInlineStart: space.s1_5,
    color: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
  findings: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  finding: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    padding: space.s3,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
  },
  findingDropped: { opacity: 0.55 },
  findingHead: { display: "flex", alignItems: "center", gap: space.s2 },
  findingTitle: { flex: 1, minWidth: 0, fontWeight: type.weightMedium },
  findingDetail: { margin: 0, paddingInlineStart: 0, color: role.contentSecondary },
  severity: {
    paddingInline: space.s1_5,
    paddingBlock: space.px,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMuted,
    color: role.contentInteractivePrimary,
    textAlign: "center",
    fontWeight: type.weightMedium,
  },
  live: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingInlineStart: 32,
    color: role.contentSecondary,
  },
  sentImage: { display: "flex", flexDirection: "column", gap: space.s2 },
  divider: { height: 1, backgroundColor: role.borderSecondaryTranslucent, flexShrink: 0 },
  mono: { fontFamily: type.fontMono, fontSize: type.fontSm, color: role.contentSecondary },
  quiet: { color: role.contentSecondary },
  reply: {
    position: { default: "static", [COMPACT]: "sticky" },
    insetBlockEnd: space.s3,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    marginInline: { default: space.s4, [NARROW]: space.s3 },
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
  sessions: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  session: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s0_5,
    width: "100%",
    padding: space.s3,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: { default: role.bgBase, ":hover": role.bgHover },
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentPrimary,
    fontFamily: "inherit",
    textAlign: "start",
    cursor: "pointer",
  },
  sessionTarget: { boxShadow: `inset 0 0 0 1px ${role.borderStrong}` },
  sessionName: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    fontWeight: type.weightMedium,
  },
  sessionMeta: { gridColumn: "1 / 3", color: role.contentSecondary },
  sessionTag: { color: role.contentTertiary },
  files: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  file: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: row.heightLg,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: role.borderSecondaryTranslucent,
  },
  filePath: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  added: { color: role.contentInteractivePrimary, fontVariantNumeric: "tabular-nums" },
  removed: { color: role.contentInteractivePrimary, fontVariantNumeric: "tabular-nums" },
});

const DUTY_LABEL = Object.fromEntries(DUTIES.map((entry) => [entry.duty, entry.label]));

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
  readonly onReply: (session: Session | undefined, text: string) => void;
  readonly onKeep: (finding: string) => void;
  readonly onStop: () => void;
}): ReactElement {
  const [panel, setPanel] = useState<Panel>(
    item.findings.length > 0 ? "findings" : item.shot === null ? "activity" : "preview",
  );

  const [target, setTarget] = useState(0);
  const [draft, setDraft] = useState("");
  const reply = useRef<HTMLInputElement | null>(null);
  const session = item.sessions[Math.min(target, item.sessions.length - 1)];
  const spent = item.sessions.reduce((sum, entry) => sum + entry.cost, 0);
  const number = item.number === null ? null : `#${String(item.number)}`;
  const finished = item.status === "merged" || item.status === "done";
  const kept = item.findings.filter((finding) => finding.kept).length;
  const primary = item.ask?.answers.find((answer) => answer.primary);
  const addressee = session === undefined ? stack.name : MODELS[session.model].short;

  const panels: readonly { readonly id: Panel; readonly label: string }[] = [
    ...(item.findings.length === 0 ? [] : [{ id: "findings" as const, label: "Findings" }]),
    ...(item.shot === null ? [] : [{ id: "preview" as const, label: "Preview" }]),
    { id: "activity", label: "Activity" },
    { id: "sessions", label: "Sessions" },
    { id: "changes", label: "Changes" },
  ];

  const answer = (chosen: Answer): void => {
    onAnswer(chosen);

    if (chosen.status === "working") reply.current?.focus();
  };

  const send = (): void => {
    if (draft.trim() === "") return;
    onReply(session, draft.trim());
    setDraft("");
    setPanel("activity");
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Enter" && event.metaKey && primary !== undefined) {
      event.preventDefault();
      answer(primary);

      return;
    }

    if (event.key === "Escape" && !editable(event.target)) onBack();

    if (event.key === "r" && !event.metaKey && !editable(event.target)) {
      event.preventDefault();
      reply.current?.focus();
    }
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
            <Button size="sm" icon="square" onClick={onStop}>
              <span {...props(parts.wideLabel)}>Stop</span>
            </Button>
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
          {item.ask !== null && (
            <div role="group" aria-label="Question for you" {...props(styles.ask)}>
              <p {...props(text.base, styles.question)}>
                <span {...props(styles.questionGlyph)}>
                  <Icon name="bubble-question" size={14} />
                </span>
                <span>
                  {item.ask.question}
                  {item.findings.length > 0 && (
                    <span {...props(styles.quiet)}>
                      {" "}
                      {kept} of {item.findings.length} kept.
                    </span>
                  )}
                </span>
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
                  <span {...props(text.sm, styles.answerHint)}>
                    <Kbd keys={["⌘", "↵"]} />
                  </span>
                )}
              </div>
            </div>
          )}
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
                ...item.sessions.map((entry) => ({
                  label: DUTY_LABEL[entry.duty] ?? entry.duty,
                  value: <ModelLabel model={entry.model} />,
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
          <Tabs.Root
            value={panel}
            onValueChange={(value) => {
              const next = panels.find((entry) => entry.id === value);

              if (next !== undefined) setPanel(next.id);
            }}
            xstyle={[styles.right, styles.fill]}
          >
            <div {...props(styles.tabs)}>
              <Tabs.List>
                {panels.map((entry) => (
                  <Tabs.Tab
                    key={entry.id}
                    value={entry.id}
                    variant="bare"
                    xstyle={[text.base, styles.tab]}
                  >
                    {entry.label}
                    {entry.id === "activity" && (
                      <span {...props(styles.tabCount)}>{item.activity.length}</span>
                    )}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </div>
            <Tabs.Panel value="findings" xstyle={styles.panel}>
              <div {...props(styles.panelInner)}>
                <ul {...props(styles.findings)}>
                  {item.findings.map((finding) => (
                    <li
                      key={finding.id}
                      {...props(styles.finding, !finding.kept && styles.findingDropped)}
                    >
                      <span {...props(styles.findingHead)}>
                        <span
                          {...props(
                            text.xs,
                            finding.severity === "fix" ? intent.warning : null,
                            styles.severity,
                          )}
                        >
                          {finding.severity === "fix" ? "Fix" : "Nit"}
                        </span>
                        <span {...props(text.base, styles.findingTitle)}>{finding.title}</span>
                        <Checkbox
                          aria-label={`Keep “${finding.title}”`}
                          checked={finding.kept}
                          disabled={item.ask === null}
                          onCheckedChange={() => onKeep(finding.id)}
                        />
                      </span>
                      <p {...props(text.base, styles.findingDetail)}>{finding.detail}</p>
                    </li>
                  ))}
                </ul>
                {item.shot !== null && <Shot id={item.shot} />}
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="preview" xstyle={styles.panel}>
              <div {...props(styles.panelInner)}>
                {item.shot !== null && <Shot id={item.shot} />}
                {item.activity
                  .flatMap((event) => event.attachment?.images ?? [])
                  .slice(0, 1)
                  .map((image) => (
                    <div key={image} {...props(styles.sentImage)}>
                      <span {...props(parts.group)}>What you sent</span>
                      <Images images={[image]} />
                    </div>
                  ))}
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="activity" xstyle={styles.panel}>
              <div {...props(styles.panelInner)}>
                <Activity events={item.activity} clock={clock} />
                {!finished && item.script.length > 0 && (
                  <span {...props(text.sm, styles.live)}>
                    <Spinner />
                    {item.now}
                  </span>
                )}
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="sessions" xstyle={styles.panel}>
              <div {...props(styles.panelInner)}>
                <ul {...props(styles.sessions)}>
                  {item.sessions.map((entry, index) => (
                    <li key={entry.duty}>
                      <button
                        type="button"
                        aria-pressed={entry === session}
                        onClick={() => {
                          setTarget(index);
                          reply.current?.focus();
                        }}
                        {...props(
                          text.base,
                          styles.session,
                          entry === session && styles.sessionTarget,
                        )}
                      >
                        <span {...props(styles.sessionName)}>
                          <ModelLabel model={entry.model} />
                          <span {...props(styles.sessionTag)}>{DUTY_LABEL[entry.duty]}</span>
                        </span>
                        <span {...props(text.sm, styles.quiet)}>{entry.state}</span>
                        <span {...props(text.sm, styles.sessionMeta)}>
                          {entry.turns} turns · ${entry.cost.toFixed(2)}
                          {entry === session && " · Replies go here"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {item.checks.length > 0 && <Checks checks={item.checks} />}
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="changes" xstyle={styles.panel}>
              <div {...props(styles.panelInner)}>
                {item.files.length === 0 ? (
                  <span {...props(text.base, styles.quiet)}>No changes yet.</span>
                ) : (
                  <ul {...props(styles.files)}>
                    {item.files.map((file) => (
                      <li key={file.path} {...props(text.sm, styles.file)}>
                        <Icon name="file" size={12} />
                        <span {...props(styles.mono, styles.filePath)}>{file.path}</span>
                        <span {...props(intent.success, styles.added)}>+{file.added}</span>
                        <span {...props(intent.danger, styles.removed)}>−{file.removed}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Tabs.Panel>
          </Tabs.Root>
          {!finished && (
            <form
              aria-label="Reply"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
              {...props(styles.reply)}
            >
              <input
                ref={reply}
                aria-label={`Reply to ${addressee}`}
                placeholder={`Reply to ${addressee}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.currentTarget.blur();
                }}
                {...props(text.base, styles.replyInput)}
              />
              <span {...props(styles.keyHint)}>
                <Kbd keys={["R"]} />
              </span>
              <Button
                type="submit"
                variant="solid"
                tone="primary"
                size="xs"
                iconOnly
                icon="arrow-up"
                aria-label="Send reply"
                disabled={draft.trim() === ""}
              />
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
