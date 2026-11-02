export type Category = "core" | "ui" | "config" | "tests" | "docs" | "generated";

export interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly string[];
}

export interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified";
  readonly category: Category;
  readonly hunks: readonly Hunk[];
  readonly preview?: { readonly hunk: number; readonly from: number; readonly to: number };
}

export interface Excerpt {
  readonly path: string;
  readonly hunk: number;
  readonly from: number;
  readonly to: number;
  readonly caption: string;
}

export type AttentionKind = "contract" | "risk" | "tradeoff" | "product" | "accessibility";

export interface Stop {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly files: readonly { readonly path: string; readonly note: string }[];
  readonly excerpts: readonly Excerpt[];
  readonly attention: { readonly kind: AttentionKind; readonly note: string } | null;
  readonly questions: readonly string[];
}

export interface Guide {
  readonly head: string;
  readonly summary: string;
  readonly stops: readonly Stop[];
  readonly unchecked: string;
  readonly changed: readonly string[];
}

export interface Finding {
  readonly id: string;
  readonly severity: "fix" | "nit";
  readonly path: string;
  readonly line: number;
  readonly title: string;
  readonly detail: string;
  readonly kept: boolean;
}

export interface Head {
  readonly oid: string;
  readonly subject: string;
  readonly files: readonly ChangedFile[];
}

export const PULL = {
  number: 489,
  title: "New empty state for the Changes panel",
  branch: "maya/changes-empty",
  base: "main",
  author: "Maya",
} as const;

const MODEL: ChangedFile = {
  path: "packages/app/src/workbench/changes/changes-model.ts",
  status: "modified",
  category: "core",
  preview: { hunk: 0, from: 3, to: 11 },
  hunks: [
    {
      oldStart: 40,
      newStart: 40,
      lines: [
        " export interface ChangesSummary {",
        "   readonly files: readonly ChangedFile[];",
        "   readonly totals: ChangeTotals;",
        "+  /** Why the list is empty, when it is; null while there are files to show. */",
        "+  readonly empty: EmptyReason | null;",
        " }",
        "+",
        "+export type EmptyReason =",
        '+  | { readonly kind: "clean" }',
        '+  | { readonly kind: "filtered"; readonly hidden: number }',
        '+  | { readonly kind: "no-repository" };',
      ],
    },
    {
      oldStart: 88,
      newStart: 95,
      lines: [
        "   const files = visibleFiles(entries, options);",
        "+  const hidden = entries.length - files.length;",
        " ",
        "   return {",
        "     files,",
        "     totals: totalsFor(files),",
        "+    empty:",
        "+      files.length > 0",
        "+        ? null",
        "+        : hidden > 0",
        '+          ? { kind: "filtered", hidden }',
        '+          : { kind: "clean" },',
        "   };",
        " }",
      ],
    },
  ],
};

function emptyState(clean: string, button: string): ChangedFile {
  return {
    path: "packages/app/src/workbench/changes/changes-empty.tsx",
    status: "added",
    category: "ui",
    preview: { hunk: 0, from: 20, to: 29 },
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        lines: [
          '+import { create, props } from "@stylexjs/stylex";',
          '+import type { ReactElement } from "react";',
          '+import { Button } from "@nyte-ai/ui/button";',
          '+import { Icon } from "@nyte-ai/ui/icon";',
          '+import { space } from "@nyte-ai/ui/styles/schema.stylex";',
          '+import { text } from "@nyte-ai/ui/styles/text.stylex";',
          '+import { role } from "@nyte-ai/ui/styles/vars.stylex";',
          '+import type { EmptyReason } from "./changes-model.ts";',
          "+",
          "+const styles = create({",
          "+  root: {",
          '+    display: "flex",',
          '+    flexDirection: "column",',
          '+    alignItems: "center",',
          "+    gap: space.s2,",
          "+    paddingBlock: space.emptyState,",
          "+    color: role.contentSecondary,",
          "+  },",
          "+});",
          "+",
          "+const COPY = {",
          `+  clean: "${clean}",`,
          '+  filtered: "Every change is hidden by a filter.",',
          `+  "no-repository": "This folder isn't a Git repository.",`,
          '+} as const satisfies Record<EmptyReason["kind"], string>;',
          "+",
          "+export function ChangesEmpty({",
          "+  reason,",
          "+  onShowAll,",
          "+}: {",
          "+  readonly reason: EmptyReason;",
          "+  readonly onShowAll: () => void;",
          "+}): ReactElement {",
          "+  return (",
          '+    <div role="status" {...props(text.sm, styles.root)}>',
          '+      <Icon name="inbox-empty" size="lg" />',
          "+      <p>{COPY[reason.kind]}</p>",
          '+      {reason.kind === "filtered" && (',
          '+        <Button size="sm" onClick={onShowAll}>',
          `+          ${button}`,
          "+        </Button>",
          "+      )}",
          "+    </div>",
          "+  );",
          "+}",
        ],
      },
    ],
  };
}

const PANEL: ChangedFile = {
  path: "packages/app/src/workbench/changes/changes-panel.tsx",
  status: "modified",
  category: "ui",
  preview: { hunk: 2, from: 0, to: 7 },
  hunks: [
    {
      oldStart: 12,
      newStart: 12,
      lines: [
        ' import { ChangesToolbar } from "./changes-toolbar.tsx";',
        '+import { ChangesEmpty } from "./changes-empty.tsx";',
        ' import { useChangesSummary } from "./changes-model.ts";',
      ],
    },
    {
      oldStart: 31,
      newStart: 32,
      lines: [
        '   list: { display: "flex", flexDirection: "column", minHeight: 0 },',
        "-  none: { padding: space.s4, color: role.contentTertiary },",
        " });",
      ],
    },
    {
      oldStart: 58,
      newStart: 58,
      lines: [
        "   const summary = useChangesSummary(scope, options);",
        " ",
        "-  if (summary.files.length === 0) return <p {...props(styles.none)}>No changes</p>;",
        "+  if (summary.empty !== null)",
        "+    return <ChangesEmpty reason={summary.empty} onShowAll={() => setOptions(SHOW_ALL)} />;",
        " ",
        "   return (",
      ],
    },
  ],
};

const TOKEN: ChangedFile = {
  path: "packages/ui/src/styles/schema.stylex.ts",
  status: "modified",
  category: "config",
  hunks: [
    {
      oldStart: 54,
      newStart: 54,
      lines: [
        '   s16: "64px",',
        "+  /** Above and below an empty state's icon and line. */",
        '+  emptyState: "48px",',
        " });",
      ],
    },
  ],
};

const LOCK: ChangedFile = {
  path: "packages/ui/test/token-lock.json",
  status: "modified",
  category: "generated",
  hunks: [
    {
      oldStart: 212,
      newStart: 212,
      lines: ['   "space.s16": "64px",', '+  "space.emptyState": "48px",', '   "space.s2": "8px",'],
    },
  ],
};

const BROWSER_TEST: ChangedFile = {
  path: "packages/app/src/workbench/changes/changes-empty.browser-test.tsx",
  status: "added",
  category: "tests",
  hunks: [
    {
      oldStart: 0,
      newStart: 1,
      lines: [
        '+import { expect, test } from "vitest";',
        '+import { render } from "vitest-browser-react";',
        '+import { ChangesEmpty } from "./changes-empty.tsx";',
        "+",
        "+test.each([",
        '+  [{ kind: "clean" }, "No changes"],',
        '+  [{ kind: "filtered", hidden: 3 }, "hidden by a filter"],',
        '+  [{ kind: "no-repository" }, "isn\'t a Git repository"],',
        '+] as const)("%o reads %s", async (reason, line) => {',
        "+  const screen = await render(<ChangesEmpty reason={reason} onShowAll={() => {}} />);",
        "+",
        '+  await expect.element(screen.getByRole("status")).toHaveTextContent(line);',
        "+});",
      ],
    },
  ],
};

const MODEL_TEST: ChangedFile = {
  path: "packages/app/src/workbench/changes/changes-model.test.ts",
  status: "modified",
  category: "tests",
  hunks: [
    {
      oldStart: 71,
      newStart: 71,
      lines: [
        "   expect(summary.files).toHaveLength(0);",
        '+  expect(summary.empty).toEqual({ kind: "filtered", hidden: 2 });',
        " });",
      ],
    },
  ],
};

const DOCS: ChangedFile = {
  path: "packages/docs/content/docs/configure/settings.mdx",
  status: "modified",
  category: "docs",
  hunks: [
    {
      oldStart: 118,
      newStart: 118,
      lines: [
        " Filters in the Changes tab hide files by status or path.",
        "+When a filter hides every change, the tab says so and offers to show the hidden files.",
        " ",
      ],
    },
  ],
};

const FIRST_FILES: readonly ChangedFile[] = [
  MODEL,
  emptyState("No changes. Your work is committed.", "Show {reason.hidden} Hidden"),
  PANEL,
  TOKEN,
  LOCK,
  BROWSER_TEST,
  MODEL_TEST,
  DOCS,
];

export const FIRST: Head = {
  oid: "9c41e2a",
  subject: "feat(app): give the Changes panel an empty state",
  files: FIRST_FILES,
};

export const SECOND: Head = {
  oid: "e07b3d5",
  subject: "fix(app): tighten the empty state's copy",
  files: FIRST_FILES.map((file) =>
    file.path === "packages/app/src/workbench/changes/changes-empty.tsx"
      ? emptyState("Nothing to review.", "Show Hidden Files")
      : file,
  ),
};

const STOPS: readonly Stop[] = [
  {
    id: "reason",
    title: "Why a list is empty",
    why: "The panel used to see only zero files. The summary now says why there are none, so the empty state can say something useful instead of “No changes”.",
    files: [
      {
        path: "packages/app/src/workbench/changes/changes-model.ts",
        note: "Start here: the reason type and the one place it's worked out.",
      },
    ],
    excerpts: [
      {
        path: "packages/app/src/workbench/changes/changes-model.ts",
        hunk: 0,
        from: 7,
        to: 11,
        caption: "Three reasons, but the summary only ever returns clean or filtered.",
      },
    ],
    attention: {
      kind: "contract",
      note: "`no-repository` is declared and has copy, but nothing returns it yet.",
    },
    questions: ["Should a filter that hides everything count as empty, or as a list with a note?"],
  },
  {
    id: "state",
    title: "The empty state itself",
    why: "One component per reason's line, with a way back when a filter hides everything. It takes the reason, not a string, so new reasons can't ship without copy.",
    files: [
      {
        path: "packages/app/src/workbench/changes/changes-empty.tsx",
        note: "Copy per reason, and the Show Hidden action.",
      },
      {
        path: "packages/ui/src/styles/schema.stylex.ts",
        note: "A new space token for the padding.",
      },
    ],
    excerpts: [
      {
        path: "packages/app/src/workbench/changes/changes-empty.tsx",
        hunk: 0,
        from: 20,
        to: 25,
        caption: "The copy. `satisfies` makes a missing reason a type error.",
      },
    ],
    attention: {
      kind: "product",
      note: "New user-facing copy. Check it still reads right in a folder with only untracked files.",
    },
    questions: ["Is “Your work is committed” true when the only changes are ignored files?"],
  },
  {
    id: "panel",
    title: "Where the panel shows it",
    why: "The panel's old one-line fallback goes, and its style with it.",
    files: [
      {
        path: "packages/app/src/workbench/changes/changes-panel.tsx",
        note: "Swaps the fallback for the empty state.",
      },
    ],
    excerpts: [
      {
        path: "packages/app/src/workbench/changes/changes-panel.tsx",
        hunk: 2,
        from: 0,
        to: 6,
        caption: "Branches on the reason, not the file count.",
      },
    ],
    attention: null,
    questions: [],
  },
  {
    id: "proof",
    title: "Tests and docs",
    why: "A table over the three reasons, one assertion on the summary, and a line in the settings docs.",
    files: [
      {
        path: "packages/app/src/workbench/changes/changes-empty.browser-test.tsx",
        note: "One row per reason.",
      },
      {
        path: "packages/app/src/workbench/changes/changes-model.test.ts",
        note: "The filtered reason counts hidden files.",
      },
      {
        path: "packages/docs/content/docs/configure/settings.mdx",
        note: "One sentence on what a full filter shows.",
      },
    ],
    excerpts: [],
    attention: null,
    questions: [],
  },
  {
    id: "other",
    title: "Other files",
    why: "Regenerated, not written.",
    files: [{ path: "packages/ui/test/token-lock.json", note: "From `lock:tokens`." }],
    excerpts: [],
    attention: null,
    questions: [],
  },
];

const SUMMARY =
  "Gives the Changes panel a reason when it's empty (clean, filtered or no repository) and an empty state that says which, with a way to show hidden files.";

const UNCHECKED =
  "Nothing ran the panel in a folder that isn't a Git repository, so that line was never on screen.";

export const FIRST_GUIDE: Guide = {
  head: FIRST.oid,
  summary: SUMMARY,
  stops: STOPS,
  unchecked: UNCHECKED,
  changed: [],
};

export const SECOND_GUIDE: Guide = {
  head: SECOND.oid,
  summary: SUMMARY,
  stops: STOPS.map((stop) =>
    stop.id === "state"
      ? {
          ...stop,
          why: "One component per reason's line, with a way back when a filter hides everything. The latest push shortens the clean line and names the button's noun.",
          attention: null,
          questions: [],
        }
      : stop,
  ),
  unchecked: UNCHECKED,
  changed: ["state"],
};

export const FINDINGS: readonly Finding[] = [
  {
    id: "unused-reason",
    severity: "fix",
    path: "packages/app/src/workbench/changes/changes-model.ts",
    line: 101,
    title: "`no-repository` is never returned",
    detail:
      "The type and the copy have it, but the summary only returns clean or filtered. Return it where the scope has no repository, or drop it.",
    kept: true,
  },
  {
    id: "one-caller-token",
    severity: "fix",
    path: "packages/ui/src/styles/schema.stylex.ts",
    line: 56,
    title: "A token for one caller",
    detail: "`space.s12` is already 48px. Use it and drop `emptyState` and its lock line.",
    kept: true,
  },
  {
    id: "button-noun",
    severity: "nit",
    path: "packages/app/src/workbench/changes/changes-empty.tsx",
    line: 39,
    title: "“Show 3 Hidden” needs a noun",
    detail: "Read as “Show 3 Hidden Files”.",
    kept: true,
  },
];

export const WRITING_STEPS: readonly string[] = [
  "Sorting 8 files",
  "Reading changes-model.ts",
  "Reading changes-empty.tsx",
  "Reading changes-panel.tsx",
  "Ordering stops",
];

export function counts(file: ChangedFile) {
  const lines = file.hunks.flatMap((hunk) => hunk.lines);

  return {
    added: lines.filter((line) => line.startsWith("+")).length,
    removed: lines.filter((line) => line.startsWith("-")).length,
  };
}

export interface DiffLine {
  readonly text: string;
  readonly kind?: "add" | "del";
}

function diffLine(line: string): DiffLine {
  const text = line.slice(1);

  if (line.startsWith("+")) return { text, kind: "add" };

  if (line.startsWith("-")) return { text, kind: "del" };

  return { text };
}

export interface HunkSlice {
  readonly start: number;
  readonly lines: readonly DiffLine[];
}

export function hunkLines(file: ChangedFile, index: number, from = 0, to?: number): HunkSlice {
  const hunk = file.hunks[index];

  if (hunk === undefined) return { start: 1, lines: [] };

  const before = hunk.lines.slice(0, from).filter((line) => !line.startsWith("-")).length;

  return { start: hunk.newStart + before, lines: hunk.lines.slice(from, to).map(diffLine) };
}

export function findFile(head: Head, path: string): ChangedFile | undefined {
  return head.files.find((file) => file.path === path);
}

export function version(path: string, head: "first" | "second"): "first" | "second" {
  return path === EMPTY_PATH ? head : "first";
}

export const EMPTY_PATH = "packages/app/src/workbench/changes/changes-empty.tsx";
