import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { ItemList } from "./list.tsx";
import type { Answer, Item, Stack } from "./model.ts";
import { Header } from "./parts.tsx";
import { pane } from "./stack-view.tsx";

const NARROW = "@container stacks (max-width: 639px)";

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    maxWidth: 1160,
    paddingInline: { default: space.s8, [NARROW]: space.s4 },
    paddingBlockStart: { default: space.s8, [NARROW]: space.s5 },
    paddingBlockEnd: 96,
  },
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

/** Every question from every stack, answerable in place. */
export function Inbox({
  stacks,
  items,
  clock,
  onOpen,
  onAnswer,
}: {
  readonly stacks: readonly Stack[];
  readonly items: readonly Item[];
  readonly clock: number;
  readonly onOpen: (item: string) => void;
  readonly onAnswer: (item: string, answer: Answer) => void;
}): ReactElement {
  const waiting = items.filter((item) => item.status === "needs-you");
  const asking = stacks.filter((stack) => waiting.some((item) => item.stack === stack.id));

  return (
    <section aria-label="Needs you" {...props(pane.pane)}>
      <Header trail={[{ label: "Needs You" }]} />
      <div {...props(pane.scroller)}>
        <div {...props(styles.page)}>
          <div {...props(pane.hero)}>
            <h1 {...props(pane.title)}>Needs you</h1>
            <p {...props(text.base, pane.summary)}>
              {waiting.length === 0
                ? "Nothing is waiting on you."
                : `${String(waiting.length)} ${waiting.length === 1 ? "decision" : "decisions"} across ${String(asking.length)} ${asking.length === 1 ? "stack" : "stacks"}.`}
            </p>
          </div>
          {waiting.length === 0 ? (
            <div {...props(text.base, styles.empty)}>
              <Icon name="inbox-checked" size={20} />
              All clear.
            </div>
          ) : (
            <ItemList
              groups={asking.map((stack) => ({
                id: stack.id,
                label: stack.name,
                items: waiting.filter((item) => item.stack === stack.id),
              }))}
              clock={clock}
              cursor={null}
              fresh={null}
              onOpen={onOpen}
              onAnswer={onAnswer}
            />
          )}
        </div>
      </div>
    </section>
  );
}
