import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { button, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { Board } from "./board.tsx";
import { ItemList } from "./list.tsx";
import { Composer, editable } from "./composer.tsx";
import type { Request } from "./delegate.ts";
import { DUTIES, GROUPS, MODELS, YOU } from "./model.ts";
import type { Answer, Duty, Item, ModelId, PullRequest, Stack } from "./model.ts";
import { Header, ModelPicker, Properties, StatusGlyph, Tile, styles as parts } from "./parts.tsx";

const COMPACT = "@container stacks (max-width: 959px)";

const NARROW = "@container stacks (max-width: 639px)";

export const pane = create({
  pane: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  scroller: { flex: 1, minHeight: 0, overflowY: "auto" },
  hero: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  number: { color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
  title: {
    margin: 0,
    fontSize: 24,
    lineHeight: "30px",
    letterSpacing: "-0.018em",
    fontWeight: type.weightMedium,
    textWrap: "balance",
  },
  summary: { margin: 0, color: role.contentSecondary, textWrap: "pretty", maxWidth: 560 },
});

type View = "list" | "board";

type Who = "all" | "yours" | "team";

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: { default: space.s8, [NARROW]: space.s6 },
    maxWidth: 1160,
    paddingInline: { default: space.s8, [NARROW]: space.s4 },
    paddingBlockStart: { default: space.s8, [NARROW]: space.s5 },
    paddingBlockEnd: 96,
  },
  top: {
    display: { default: "grid", [COMPACT]: "contents" },
    gridTemplateColumns: { default: "minmax(0, 1fr) 300px", [COMPACT]: "minmax(0, 1fr)" },
    columnGap: space.s8,
    rowGap: space.s6,
  },
  main: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  heroTop: { display: "flex", flexDirection: "column", gap: space.s4 },
  rail: {
    order: { default: 0, [COMPACT]: 1 },
    display: { default: "flex", [COMPACT]: "grid" },
    flexDirection: "column",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
    alignContent: "start",
    gap: space.s6,
    minWidth: 0,
    paddingInlineStart: { default: space.s6, [COMPACT]: 0 },
    paddingBlockStart: { default: 0, [COMPACT]: space.s6 },
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderWidth: 0,
    borderInlineStartWidth: { default: 1, [COMPACT]: 0 },
    borderBlockStartWidth: { default: 0, [COMPACT]: 1 },
  },
  crewLine: {
    display: { default: "none", [COMPACT]: "flex" },
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    color: role.contentSecondary,
  },
  crewEntry: { display: "inline-flex", alignItems: "center", gap: space.s1_5 },
  railSection: { display: "flex", flexDirection: "column", gap: space.s2 },
  work: { display: "flex", flexDirection: "column", gap: space.s4 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s3,
  },
  toolbarEnd: { display: "flex", alignItems: "center", gap: space.s3, color: role.contentTertiary },
  hint: { display: "flex", alignItems: "center", gap: space.s1_5 },
  skills: { display: "flex", flexWrap: "wrap", gap: space.s1_5 },
  skill: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    height: button.heightSm,
    paddingInline: space.s2,
    borderRadius: radius.control,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
  },
  asks: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: role.contentPrimary,
  },
  ask: { display: "flex", alignItems: "center", gap: space.s2 },
  askGlyph: { display: "inline-flex", color: role.contentTertiary },
  meter: { display: "flex", flexDirection: "column", gap: space.s2 },
  meterLine: { display: "flex", justifyContent: "space-between", color: role.contentSecondary },
  meterValue: { color: role.contentPrimary, fontVariantNumeric: "tabular-nums" },
  bar: {
    display: "block",
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: role.bgMuted,
    overflow: "hidden",
  },
  barFill: {
    display: "block",
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
    transitionProperty: "width",
    transitionDuration: motion.durationNormal,
  },
  receipt: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: 40,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s1_5,
    borderRadius: radius.card,
    backgroundColor: role.bgMuted,
  },
  receiptText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  receiptNow: { color: role.contentSecondary, whiteSpace: "nowrap" },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s8,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentTertiary,
  },
});

export function StackView({
  stack,
  items,
  pulls,
  fresh,
  clock,
  onSend,
  onOpen,
  onAnswer,
  onCrew,
  onEdit,
}: {
  readonly stack: Stack;
  readonly items: readonly Item[];
  readonly pulls: readonly PullRequest[];
  readonly fresh: string | null;
  readonly clock: number;
  readonly onSend: (request: Request) => void;
  readonly onOpen: (item: string) => void;
  readonly onAnswer: (item: string, answer: Answer) => void;
  readonly onCrew: (duty: Duty, model: ModelId) => void;
  readonly onEdit: () => void;
}): ReactElement {
  const [view, setView] = useState<View>("list");
  const [who, setWho] = useState<Who>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const sent = items.find((item) => item.id === fresh);

  const shown = items.filter((item) =>
    who === "all" ? true : who === "yours" ? item.author.id === YOU.id : item.author.id !== YOU.id,
  );

  const order = GROUPS.flatMap((group) =>
    shown.filter((item) => group.statuses.includes(item.status)),
  );

  const done = items.filter((item) => item.status === "merged" || item.status === "done").length;

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
    const at = order.findIndex((item) => item.id === cursor);

    if (event.key === "j" || event.key === "k") {
      event.preventDefault();

      const next =
        order[Math.max(0, Math.min(order.length - 1, at + (event.key === "j" ? 1 : -1)))];

      if (next !== undefined) setCursor(next.id);

      return;
    }

    if (event.key === "Enter" && cursor !== null) {
      event.preventDefault();
      onOpen(cursor);
    }
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey(event);

    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  return (
    <section aria-label={stack.name} {...props(pane.pane)}>
      <Header
        trail={[{ label: "Stacks" }, { label: stack.name }]}
        actions={
          <Button size="sm" icon="pencil" onClick={onEdit}>
            <span {...props(parts.wideLabel)}>Edit Stack</span>
          </Button>
        }
      />
      <div {...props(pane.scroller)}>
        <div {...props(styles.page)}>
          <div {...props(styles.top)}>
            <div {...props(styles.main)}>
              <div {...props(styles.heroTop)}>
                <Tile surface={stack} size="lg" />
                <div {...props(pane.hero)}>
                  <h1 {...props(pane.title)}>{stack.name}</h1>
                  <p {...props(text.base, pane.summary)}>{stack.purpose}</p>
                </div>
                <span {...props(text.sm, styles.crewLine)}>
                  {DUTIES.map((entry) => (
                    <span key={entry.duty} {...props(styles.crewEntry)}>
                      <Icon name={MODELS[stack.crew[entry.duty]].icon} size={12} />
                      {MODELS[stack.crew[entry.duty]].short} {entry.label.toLowerCase()}
                    </span>
                  ))}
                </span>
              </div>
              <Composer
                stack={stack}
                pulls={pulls}
                onSend={onSend}
                receipt={
                  sent !== undefined && (
                    <div role="status" {...props(text.base, styles.receipt)}>
                      <StatusGlyph status={sent.status} />
                      <span {...props(styles.receiptText)}>
                        {sent.number !== null && (
                          <span {...props(pane.number)}>#{sent.number} </span>
                        )}
                        {sent.title}
                      </span>
                      <span {...props(styles.receiptNow)}>{sent.now}</span>
                      <Button size="xs" variant="outline" onClick={() => onOpen(sent.id)}>
                        Open
                      </Button>
                    </div>
                  )
                }
              />
            </div>
            <Rail stack={stack} done={done} total={items.length} onCrew={onCrew} />
          </div>
          <div {...props(styles.work)}>
            <div {...props(styles.toolbar)}>
              <ToggleGroup
                aria-label="Whose work"
                value={[who]}
                onValueChange={(values) => {
                  const next = values.at(-1);

                  if (next === "all" || next === "yours" || next === "team") setWho(next);
                }}
              >
                <Toggle value="all" size="sm">
                  All
                </Toggle>
                <Toggle value="yours" size="sm">
                  Yours
                </Toggle>
                <Toggle value="team" size="sm">
                  Teammates&apos;
                </Toggle>
              </ToggleGroup>
              <span {...props(text.sm, styles.toolbarEnd)}>
                <span {...props(styles.hint)}>
                  <Kbd keys={["J"]} />
                  <Kbd keys={["K"]} />
                  to move
                </span>
                <ToggleGroup
                  aria-label="Layout"
                  value={[view]}
                  onValueChange={(values) => {
                    const next = values.at(-1);

                    if (next === "list" || next === "board") setView(next);
                  }}
                >
                  <Toggle value="list" size="sm" icon="list">
                    List
                  </Toggle>
                  <Toggle value="board" size="sm" icon="canvas-grid">
                    Board
                  </Toggle>
                </ToggleGroup>
              </span>
            </div>
            {shown.length === 0 ? (
              <div {...props(text.base, styles.empty)}>
                <Icon name="inbox-empty" size={20} />
                Nothing here yet.
              </div>
            ) : view === "board" ? (
              <Board items={shown} clock={clock} cursor={cursor} fresh={fresh} onOpen={onOpen} />
            ) : (
              <ItemList
                groups={GROUPS.map((group) => ({
                  id: group.id,
                  label: group.label,
                  items: shown.filter((item) => group.statuses.includes(item.status)),
                }))}
                clock={clock}
                cursor={cursor}
                fresh={fresh}
                onOpen={onOpen}
                onAnswer={onAnswer}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Rail({
  stack,
  done,
  total,
  onCrew,
}: {
  readonly stack: Stack;
  readonly done: number;
  readonly total: number;
  readonly onCrew: (duty: Duty, model: ModelId) => void;
}): ReactElement {
  return (
    <aside aria-label={`How ${stack.name} works`} {...props(styles.rail)}>
      <div {...props(styles.railSection)}>
        <span {...props(parts.group)}>Crew</span>
        <Properties
          rows={DUTIES.map((entry) => ({
            label: entry.label,
            value: (
              <ModelPicker
                label={entry.label}
                value={stack.crew[entry.duty]}
                onChange={(model) => onCrew(entry.duty, model)}
              />
            ),
          }))}
        />
      </div>
      <div {...props(styles.railSection)}>
        <span {...props(parts.group)}>Reads every time</span>
        <div {...props(styles.skills)}>
          {stack.skills.map((skill) => (
            <span key={skill} {...props(text.sm, styles.skill)}>
              <Icon name="skills" size={12} />
              {skill}
            </span>
          ))}
        </div>
      </div>
      <div {...props(styles.railSection)}>
        <span {...props(parts.group)}>Asks you</span>
        <ul {...props(text.base, styles.asks)}>
          {stack.asks.map((ask) => (
            <li key={ask} {...props(styles.ask)}>
              <span {...props(styles.askGlyph)}>
                <Icon name="bubble-question" size={14} />
              </span>
              {ask}
            </li>
          ))}
        </ul>
      </div>
      {stack.due !== null && (
        <Meter
          label={`Due ${stack.due}`}
          value={`${String(done)} of ${String(total)} done`}
          ratio={total === 0 ? 0 : done / total}
        />
      )}
      <Meter
        label="Today"
        value={`$${stack.spent.toFixed(2)} of $${String(stack.budget)}`}
        ratio={stack.spent / stack.budget}
      />
    </aside>
  );
}

function Meter({
  label,
  value,
  ratio,
}: {
  readonly label: string;
  readonly value: string;
  readonly ratio: number;
}): ReactElement {
  return (
    <div {...props(styles.railSection)}>
      <span {...props(parts.group)}>{label}</span>
      <div {...props(styles.meter)}>
        <span {...props(text.base, styles.meterLine, styles.meterValue)}>{value}</span>
        <span {...props(styles.bar)}>
          <span
            {...props(styles.barFill)}
            style={{ width: `${String(Math.round(Math.min(1, ratio) * 100))}%` }}
          />
        </span>
      </div>
    </div>
  );
}
