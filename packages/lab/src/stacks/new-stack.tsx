import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { CheckboxField } from "@nyte-ai/ui/checkbox";
import { Input } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { ASKS, DUTIES, SKILLS } from "./model.ts";
import type { Stack } from "./model.ts";
import { Header, ModelPicker, Properties, Tile, styles as parts } from "./parts.tsx";
import { pane } from "./stack-view.tsx";

const NARROW = "@container stacks (max-width: 639px)";

const BUDGETS = [5, 15, 30] as const;

const TINTS = ["blue", "orange", "teal", "pink", "yellow"] as const;

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    maxWidth: 680,
    paddingInline: { default: space.s8, [NARROW]: space.s4 },
    paddingBlockStart: { default: space.s8, [NARROW]: space.s5 },
    paddingBlockEnd: 96,
  },
  heroTop: { display: "flex", flexDirection: "column", gap: space.s4 },
  section: { display: "flex", flexDirection: "column", gap: space.s3 },
  sectionStart: { alignItems: "flex-start" },
  field: { width: "100%" },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s1_5 },
  asks: { display: "flex", flexDirection: "column", gap: space.s2 },
  actions: { display: "flex", gap: space.s2 },
  quiet: { margin: 0, color: role.contentSecondary },
});

/** Everything a stack needs, on one page, with nothing hidden. Pass `initial` to edit one. */
export function NewStack({
  count,
  initial,
  onCreate,
  onCancel,
}: {
  readonly count: number;
  readonly initial?: Stack;
  readonly onCreate: (stack: Stack) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState<Stack>(
    initial ?? {
      id: `stack-${String(count)}`,
      name: "",
      purpose: "",
      icon: "layers",
      tint: TINTS[count % TINTS.length] ?? "blue",
      crew: { writes: "sol", reviews: "opus", watches: "mini" },
      skills: ["verify-nyte"],
      asks: ["Before merging", "Before pushing to a teammate's branch"],
      spent: 0,
      budget: 15,
      due: null,
    },
  );

  const name = draft.name.trim();

  return (
    <section aria-label="New stack" {...props(pane.pane)}>
      <Header
        trail={[
          { label: "Stacks" },
          ...(initial === undefined ? [] : [{ label: initial.name, onClick: onCancel }]),
          { label: initial === undefined ? "New Stack" : "Edit" },
        ]}
      />
      <div {...props(pane.scroller)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();

            if (name !== "") onCreate({ ...draft, name });
          }}
          {...props(styles.page)}
        >
          <div {...props(styles.heroTop)}>
            <Tile surface={draft} size="lg" />
            <div {...props(pane.hero)}>
              <h1 {...props(pane.title)}>{name === "" ? "New stack" : name}</h1>
              <p {...props(text.base, styles.quiet)}>
                {draft.purpose.trim() === ""
                  ? "A crew of models with its own rules."
                  : draft.purpose}
              </p>
            </div>
          </div>
          <Properties
            rows={[
              {
                label: "Name",
                value: (
                  <Input
                    autoFocus
                    aria-label="Name"
                    placeholder="Docs"
                    value={draft.name}
                    onValueChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                    xstyle={styles.field}
                  />
                ),
              },
              {
                label: "For",
                value: (
                  <Input
                    aria-label="What it's for"
                    placeholder="Keep the docs true to what shipped"
                    value={draft.purpose}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, purpose: value }))
                    }
                    xstyle={styles.field}
                  />
                ),
              },
            ]}
          />
          <div {...props(styles.section)}>
            <span {...props(parts.group)}>Crew</span>
            <Properties
              rows={DUTIES.map((entry) => ({
                label: entry.label,
                value: (
                  <ModelPicker
                    label={entry.label}
                    value={draft.crew[entry.duty]}
                    onChange={(model) =>
                      setDraft((current) => ({
                        ...current,
                        crew: { ...current.crew, [entry.duty]: model },
                      }))
                    }
                  />
                ),
              }))}
            />
          </div>
          <div {...props(styles.section)}>
            <span {...props(parts.group)}>Reads every time</span>
            <div {...props(styles.chips)}>
              {SKILLS.map((skill) => (
                <Toggle
                  key={skill}
                  size="sm"
                  icon="skills"
                  pressed={draft.skills.includes(skill)}
                  onPressedChange={(pressed) =>
                    setDraft((current) => ({
                      ...current,
                      skills: pressed
                        ? [...current.skills, skill]
                        : current.skills.filter((entry) => entry !== skill),
                    }))
                  }
                >
                  {skill}
                </Toggle>
              ))}
            </div>
          </div>
          <div {...props(styles.section)}>
            <span {...props(parts.group)}>Asks you</span>
            <div {...props(styles.asks)}>
              {ASKS.map((ask) => (
                <CheckboxField
                  key={ask}
                  label={ask}
                  checked={draft.asks.includes(ask)}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      asks: checked
                        ? [...current.asks, ask]
                        : current.asks.filter((entry) => entry !== ask),
                    }))
                  }
                />
              ))}
            </div>
          </div>
          <div {...props(styles.section, styles.sectionStart)}>
            <span {...props(parts.group)}>Spends at most</span>
            <ToggleGroup
              aria-label="Daily budget"
              value={[String(draft.budget)]}
              onValueChange={(values) => {
                const next = BUDGETS.find((budget) => String(budget) === values.at(-1));

                if (next !== undefined) setDraft((current) => ({ ...current, budget: next }));
              }}
            >
              {BUDGETS.map((budget) => (
                <Toggle key={budget} value={String(budget)} size="sm">
                  ${budget} a day
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <div {...props(styles.actions)}>
            <Button type="submit" variant="solid" tone="primary" disabled={name === ""}>
              {initial === undefined ? "Create Stack" : "Save Changes"}
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </div>
    </section>
  );
}
