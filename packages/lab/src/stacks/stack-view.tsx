import { create, props } from "@stylexjs/stylex";
import { useEffectEvent, useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { Composer, editable } from "./composer.tsx";
import type { Request } from "./delegate.ts";
import { DropZone, useCarrying } from "./dnd.tsx";
import { ItemList } from "./list.tsx";
import { GROUPS, MODELS } from "./model.ts";
import type { Item, PullRequest, Stack } from "./model.ts";
import { Header, Tile } from "./parts.tsx";
import { WATCHER } from "./staffing.ts";

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

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: { default: space.s8, [NARROW]: space.s6 },
    maxWidth: 820,
    paddingInline: { default: space.s8, [NARROW]: space.s4 },
    paddingBlockStart: { default: space.s8, [NARROW]: space.s5 },
    paddingBlockEnd: 96,
  },
  heroTop: { display: "flex", flexDirection: "column", gap: space.s4 },
  people: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s1,
    color: role.contentSecondary,
  },
  person: { display: "inline-flex", alignItems: "center", gap: space.s1_5 },
  personLead: { color: role.contentPrimary },
  dot: { color: role.contentDisabled },
  drop: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s5,
    color: role.contentSecondary,
    borderRadius: radius.card,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s8,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentTertiary,
  },
});

/**
 * Interfere's inbox: one column you read top to bottom. Who works here, one place to ask for
 * something, then everything in flight, grouped by what it waits on.
 */
export function StackView({
  stack,
  items,
  pulls,
  fresh,
  clock,
  chats,
  onSend,
  onOpen,
  onEdit,
}: {
  readonly stack: Stack;
  readonly items: readonly Item[];
  readonly pulls: readonly PullRequest[];
  readonly fresh: string | null;
  readonly clock: number;
  readonly chats: Readonly<Record<string, string>>;
  readonly onSend: (request: Request) => void;
  readonly onOpen: (item: string) => void;
  readonly onEdit: () => void;
}): ReactElement {
  const [cursor, setCursor] = useState<string | null>(null);
  const carrying = useCarrying();

  const order = GROUPS.flatMap((group) =>
    items.filter((item) => group.statuses.includes(item.status)),
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
          <Menu>
            <MenuTrigger
              render={
                <Button size="sm" iconOnly icon="more-horizontal" aria-label="Stack Actions" />
              }
            />
            <MenuContent align="end">
              <MenuItem icon="pencil" onClick={onEdit}>
                Edit Agents and Rules
              </MenuItem>
            </MenuContent>
          </Menu>
        }
      />
      <div {...props(pane.scroller)}>
        <div {...props(styles.page)}>
          <div {...props(styles.heroTop)}>
            <Tile surface={stack} size="lg" />
            <div {...props(pane.hero)}>
              <h1 {...props(pane.title)}>{stack.name}</h1>
              <p {...props(text.base, pane.summary)}>{stack.purpose}</p>
            </div>
            <People stack={stack} done={done} total={items.length} />
          </div>
          <Composer stack={stack} pulls={pulls} onSend={onSend} />
          {carrying !== null && chats[carrying] !== stack.id && (
            <DropZone stack={stack.id} label="page">
              <div {...props(text.base, styles.drop)}>
                <Icon name="layers" size={16} />
                Drop to hand it to {stack.name}
              </div>
            </DropZone>
          )}
          {items.length === 0 ? (
            <div {...props(text.base, styles.empty)}>
              Nothing here yet.
              <span {...props(text.sm)}>Write above, or drag a chat in from the sidebar.</span>
            </div>
          ) : (
            <ItemList
              groups={GROUPS.map((group) => ({
                id: group.id,
                label: group.label,
                items: items.filter((item) => group.statuses.includes(item.status)),
              }))}
              clock={clock}
              cursor={cursor}
              fresh={fresh}
              onOpen={onOpen}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** Who works here, in one line: the lead, each agent, CI, and what today cost. */
function People({
  stack,
  done,
  total,
}: {
  readonly stack: Stack;
  readonly done: number;
  readonly total: number;
}): ReactElement {
  const separator = (
    <span aria-hidden="true" {...props(styles.dot)}>
      ·
    </span>
  );

  return (
    <div {...props(text.sm, styles.people)}>
      <Who
        icon={MODELS[stack.lead].icon}
        name={`${stack.name} leads`}
        detail={`${MODELS[stack.lead].name} · Plans each task, reviews it and opens the pull request`}
        lead
      />
      {stack.agents.map((agent) => (
        <Who
          key={agent.id}
          icon={MODELS[agent.model].icon}
          name={agent.name}
          detail={`${MODELS[agent.model].name} · ${agent.does}`}
          lead={false}
        />
      ))}
      <Who
        icon="server"
        name={`${WATCHER} watches CI`}
        detail="No model runs until something fails"
        lead={false}
      />
      {separator}
      <span>
        ${stack.spent.toFixed(2)} of ${stack.budget} today
      </span>
      {stack.due !== null && (
        <>
          {separator}
          <span>
            Due {stack.due}, {done} of {total} done
          </span>
        </>
      )}
    </div>
  );
}

function Who({
  icon,
  name,
  detail,
  lead,
}: {
  readonly icon: IconName;
  readonly name: string;
  readonly detail: string;
  readonly lead: boolean;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} {...props(styles.person, lead && styles.personLead)} />}
      >
        <Icon name={icon} size={12} />
        {name}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}
