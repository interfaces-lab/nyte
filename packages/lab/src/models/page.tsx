import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Chips, Pages, Palette, SideBySide, Today } from "./composer-takes";
import { OneList, SamePicker, SettingsToday } from "./settings-takes";

interface Take {
  readonly title: string;
  readonly note: string;
  readonly render: () => ReactElement;
}

const COMPOSER: readonly Take[] = [
  {
    title: "Today",
    note: "The shipped picker. Model and Reasoning are submenus that open on hover, so search is two steps away.",
    render: () => <Today />,
  },
  {
    title: "One popover",
    note: "Opens on the search field, like the branch picker. Reasoning and Fast sit under the list as plain controls.",
    render: () => <Palette />,
  },
  {
    title: "Three controls",
    note: "Model, reasoning and Fast each get their own button. Every one is a single click.",
    render: () => <Chips />,
  },
  {
    title: "Pages",
    note: "Today’s rows, but a click opens each in place, with a back row. Typing on the first page starts a search.",
    render: () => <Pages />,
  },
  {
    title: "Side by side",
    note: "The list on the left, the chosen model’s facts and settings on the right. Picking keeps it open.",
    render: () => <SideBySide />,
  },
];

const SETTINGS: readonly Take[] = [
  {
    title: "Today",
    note: "Agent has a Select of every model. Providers has a separate star and switch list per provider.",
    render: () => <SettingsToday />,
  },
  {
    title: "Same picker",
    note: "The default model opens the composer’s popover: same search, same rows, same Starred group.",
    render: () => <SamePicker />,
  },
  {
    title: "One list",
    note: "Every connected model in one searchable list, with the picker’s rows and the default marked.",
    render: () => <OneList />,
  },
];

const styles = create({
  page: {
    minHeight: "100vh",
    paddingBlock: "48px 120px",
    paddingInline: 40,
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    maxWidth: 640,
    marginBlockEnd: 40,
  },
  title: { margin: 0, fontWeight: type.weightSemibold },
  note: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
  part: { display: "flex", flexDirection: "column", gap: space.s4, marginBlockEnd: 48 },
  partTitle: { margin: 0, fontWeight: type.weightSemibold },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
    gap: space.s8,
    alignItems: "start",
  },
  wideGrid: { gridTemplateColumns: "repeat(auto-fill, minmax(520px, 1fr))" },
  cell: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  cellHead: { display: "flex", alignItems: "baseline", gap: space.s2 },
  index: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  cellTitle: { margin: 0, fontWeight: type.weightSemibold },
  cellNote: { margin: 0, color: role.contentSecondary, textWrap: "pretty" },
});

export function ModelsPage(): ReactElement {
  return (
    <main {...props(text.base, styles.page)}>
      <header {...props(styles.header)}>
        <h1 {...props(text.lg, styles.title)}>Model picker</h1>
        <p {...props(styles.note)}>
          Takes on choosing a model, its reasoning and Fast, in the composer and in Settings. Every
          take shares one row: the maker’s mark, then the name.
        </p>
      </header>
      <Part title="Composer" takes={COMPOSER} />
      <Part title="Settings" takes={SETTINGS} wide />
    </main>
  );
}

function Part({
  title,
  takes,
  wide = false,
}: {
  readonly title: string;
  readonly takes: readonly Take[];
  readonly wide?: boolean;
}): ReactElement {
  return (
    <section {...props(styles.part)}>
      <h2 {...props(text.base, styles.partTitle)}>{title}</h2>
      <div {...props(styles.grid, wide && styles.wideGrid)}>
        {takes.map((take, index) => (
          <section key={take.title} {...props(styles.cell)}>
            <div {...props(styles.cellHead)}>
              <span {...props(text.xs, styles.index)}>{String(index).padStart(2, "0")}</span>
              <h3 {...props(text.base, styles.cellTitle)}>{take.title}</h3>
            </div>
            <p {...props(text.sm, styles.cellNote)}>{take.note}</p>
            {take.render()}
          </section>
        ))}
      </div>
    </section>
  );
}
