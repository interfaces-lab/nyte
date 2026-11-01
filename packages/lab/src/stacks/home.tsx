import { create, props } from "@stylexjs/stylex";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { Briefing } from "./briefing.tsx";
import { Composer } from "./composer.tsx";
import type { Request } from "./delegate.ts";
import { ItemList, useCursor } from "./list.tsx";
import type { Context, ListGroup } from "./list.tsx";
import type { Item, PullRequest, Stack } from "./model.ts";
import { Header } from "./parts.tsx";
import { LANES, arrange, lane } from "./progress.ts";
import { page, pane } from "./stack-view.tsx";

export interface Display {
  readonly group: "lane" | "stack";
  readonly finished: boolean;
}

const styles = create({
  greeting: { display: "flex", flexDirection: "column", gap: space.s4 },
});

/**
 * Every stack on one page, read top to bottom: a greeting, what to do first in a sentence, one
 * place to write, then everything in flight by what it waits on, or by stack.
 */
export function Home({
  stacks,
  items,
  pulls,
  focus,
  context,
  fresh,
  display,
  changed,
  onDisplay,
  onSend,
  onOpen,
  onSeen,
}: {
  readonly stacks: readonly Stack[];
  readonly items: readonly Item[];
  readonly pulls: readonly PullRequest[];
  readonly focus: string | null;
  readonly context: Context;
  readonly fresh: string | null;
  readonly display: Display;
  readonly changed: number;
  readonly onDisplay: (display: Display) => void;
  readonly onSend: (stack: string, request: Request) => void;
  readonly onOpen: (item: string) => void;
  readonly onSeen: () => void;
}): ReactElement {
  const [linked, setLinked] = useState<string | null>(null);
  const greeting = useSyncExternalStore(subscribeNever, readGreeting, () => "Hello.");
  const shown = display.finished ? items : items.filter((item) => lane(item) !== "finished");

  const groups: readonly ListGroup[] =
    display.group === "stack"
      ? stacks.map((stack) => ({
          id: stack.id,
          label: stack.name,
          items: arrange(shown.filter((item) => item.stack === stack.id)),
        }))
      : LANES.map((entry) => ({
          id: entry.id,
          label: entry.label,
          items: arrange(shown.filter((item) => lane(item) === entry.id)),
        }));

  const cursor = useCursor(
    groups.flatMap((group) => group.items),
    onOpen,
  );

  return (
    <section aria-label="Home" {...props(pane.pane)}>
      <Header
        trail={[{ label: "Home" }]}
        actions={<DisplayMenu display={display} onDisplay={onDisplay} />}
      />
      <div {...props(pane.scroller)}>
        <div {...props(page.page)}>
          <div {...props(styles.greeting)}>
            <h1 {...props(pane.title)}>{greeting}</h1>
            <Briefing
              items={items}
              changed={changed}
              onOpen={onOpen}
              onLink={setLinked}
              onSeen={onSeen}
            />
          </div>
          <Composer
            key={focus ?? "all"}
            stacks={stacks}
            preferred={focus}
            items={items}
            pulls={pulls}
            onSend={onSend}
          />
          <ItemList
            groups={groups}
            context={{
              ...context,
              stacks: display.group === "lane" && stacks.length > 1 ? stacks : null,
            }}
            cursor={cursor}
            fresh={fresh}
            linked={linked}
            onOpen={onOpen}
          />
        </div>
      </div>
    </section>
  );
}

function DisplayMenu({
  display,
  onDisplay,
}: {
  readonly display: Display;
  readonly onDisplay: (display: Display) => void;
}): ReactElement {
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" iconOnly icon="filters" aria-label="Display Options" />}
      />
      <MenuContent align="end">
        <MenuGroup>
          <MenuGroupLabel>Group By</MenuGroupLabel>
          <MenuRadioGroup
            value={display.group}
            onValueChange={(value) => {
              if (value === "lane" || value === "stack") onDisplay({ ...display, group: value });
            }}
          >
            <MenuRadioItem value="lane">What It Waits On</MenuRadioItem>
            <MenuRadioItem value="stack">Stack</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={display.finished}
          onCheckedChange={(checked) => onDisplay({ ...display, finished: checked })}
        >
          Show Finished
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

function subscribeNever(): () => void {
  return () => undefined;
}

/** Read on the client only, so the server's render never disagrees with the hour. */
function readGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 5) return "Working late.";

  if (hour < 12) return "Good morning.";

  return hour < 18 ? "Good afternoon." : "Good evening.";
}
