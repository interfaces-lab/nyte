import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { styles } from "./page.stylex";
import {
  BranchFirst,
  Collapsed,
  Compact,
  Composer,
  CountAware,
  Diffstat,
  Docked,
  QuietHeader,
  Sections,
  StatusLetters,
  Subject,
  Tree,
} from "./takes";

const IDEAS: readonly {
  readonly title: string;
  readonly note: string;
  readonly render: () => ReactElement;
}[] = [
  {
    title: "Composer",
    note: "The message and the action share one field, like the chat composer. The full-width grey bar goes away.",
    render: () => <Composer />,
  },
  {
    title: "Docked commit",
    note: "Files come first; the commit bar sits at the bottom of the panel, where the composer sits in chat.",
    render: () => <Docked />,
  },
  {
    title: "Quiet header",
    note: "Scope is plain text, with branch and totals on one line under it. Toolbar icons show on hover.",
    render: () => <QuietHeader />,
  },
  {
    title: "Status letters",
    note: "M, A or D replaces the generic file glyph. Stats go grey and checkboxes appear only on hover or when ticked.",
    render: () => <StatusLetters />,
  },
  {
    title: "Staged and Changes",
    note: "Two collapsible groups instead of checkboxes, so the staged set is visible at a glance.",
    render: () => <Sections />,
  },
  {
    title: "Branch first",
    note: "The branch is the title, with commits ahead. Scope becomes a segmented control instead of a dropdown.",
    render: () => <BranchFirst />,
  },
  {
    title: "Diffstat",
    note: "A red and green bar shows the shape of the change. Rows show one total plus five blocks.",
    render: () => <Diffstat />,
  },
  {
    title: "Folder tree",
    note: "Files grouped under their folder, so long paths stop being truncated and siblings sit together.",
    render: () => <Tree />,
  },
  {
    title: "Collapsed commit",
    note: "One quiet row until you want it. It opens into a summary, a description and a generate button.",
    render: () => <Collapsed />,
  },
  {
    title: "Count-aware button",
    note: "The button says what will happen or why it can't, with a select-all row above the list.",
    render: () => <CountAware />,
  },
  {
    title: "Compact",
    note: "Scope, branch and totals fit on one line, with a small Commit button beside the field.",
    render: () => <Compact />,
  },
  {
    title: "Subject and body",
    note: "Git's subject and body as two fields, with a counter that counts down from 50.",
    render: () => <Subject />,
  },
];

export function ChangesPage(): ReactElement {
  return (
    <main {...props(styles.page)}>
      <header {...props(styles.pageHeader)}>
        <h1 {...props(styles.pageTitle)}>Changes tab</h1>
        <p {...props(styles.pageNote)}>
          Twelve takes on the working-tree panel. Same files in each; hover rows and try the
          controls.
        </p>
      </header>
      <div {...props(styles.grid)}>
        {IDEAS.map((idea, index) => (
          <section key={idea.title} {...props(styles.cell)}>
            <div {...props(styles.cellHead)}>
              <span {...props(styles.index)}>{String(index + 1).padStart(2, "0")}</span>
              <h2 {...props(styles.cellTitle)}>{idea.title}</h2>
            </div>
            <p {...props(styles.cellNote)}>{idea.note}</p>
            <div {...props(styles.panel)}>{idea.render()}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
