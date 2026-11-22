import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { closeWindow, editor, expect, goTo, test } from "./desk.ts";

type Step =
  | { readonly type: string }
  | { readonly press: string }
  | { readonly pressTimes: readonly [string, number] }
  | { readonly clipboard: string }
  | { readonly goTo: readonly [number, number] }
  | { readonly clickEnd: number };

interface Edge {
  readonly id: string;
  readonly name: string;
  readonly before: string;
  readonly steps: readonly Step[];
  readonly after: string;
  readonly goland: string;
}

interface Caret {
  readonly anchor: number;
  readonly head: number;
}

interface Marked {
  readonly text: string;
  readonly carets: readonly Caret[];
}

interface Spot {
  readonly line: number;
  readonly column: number;
  readonly character: number;
}

interface Outcome {
  readonly id: string;
  readonly name: string;
  readonly goland: string;
  readonly pass: boolean;
  readonly got: string;
  readonly want: string;
  readonly caret: string;
  readonly wantCaret: string;
  readonly carets: number;
  readonly selected: boolean;
  readonly notes: readonly string[];
}

const HOLD_MS = 40;

const TAB_COLUMNS = 4;

const BUILD = join(import.meta.dirname, "..", "out-e2e", "renderer", "index.html");

const SAVED_MS = 10_000;

const STATUS = /^(Ln \d+, Col \d+|\d+ lines selected)$/u;

function inFunc(...rows: readonly string[]): string {
  return `package main\n\nfunc f() {\n${rows.join("\n")}\n}\n`;
}

function file(...rows: readonly string[]): string {
  return `${rows.join("\n")}\n`;
}

const EDGES: readonly Edge[] = [
  {
    id: "1",
    name: "an arrow splits the typing undo group",
    before: inFunc("\t‸"),
    steps: [{ type: "abc" }, { press: "ArrowLeft" }, { type: "d" }, { press: "Meta+z" }],
    after: inFunc("\tab‸c"),
    goland: "first ⌘Z removes only d",
  },
  {
    id: "3",
    name: "a typed run undoes in one step",
    before: inFunc("\t‸"),
    steps: [{ type: "foo bar baz" }, { press: "Meta+z" }],
    after: inFunc("\t‸"),
    goland: "one undo step for the whole run, no word split",
  },
  {
    id: "4",
    name: "deletes merge with each other, not with typing",
    before: inFunc("\tab‸"),
    steps: [{ type: "x" }, { pressTimes: ["Backspace", 2] }, { press: "Meta+z" }],
    after: inFunc("\tabx‸"),
    goland: "⌘Z restores both deleted chars, keeps x",
  },
  {
    id: "5",
    name: "each Enter is its own undo step",
    before: file("var a = 1‸", "var b = 2"),
    steps: [{ pressTimes: ["Enter", 3] }, { press: "Meta+z" }],
    after: file("var a = 1", "", "‸", "var b = 2"),
    goland: "⌘Z undoes one of three Enters",
  },
  {
    id: "6",
    name: "undo removes ( and its auto-inserted )",
    before: inFunc("\tf‸"),
    steps: [{ type: "(" }, { press: "Meta+z" }],
    after: inFunc("\tf‸"),
    goland: "one ⌘Z removes both",
  },
  {
    id: "8",
    name: "( before an identifier inserts no )",
    before: inFunc("\tf‸x"),
    steps: [{ type: "(" }],
    after: inFunc("\tf(‸x"),
    goland: "(|x, no closer",
  },
  {
    id: "9",
    name: "( at line end pairs",
    before: inFunc("\tf‸"),
    steps: [{ type: "(" }],
    after: inFunc("\tf(‸)"),
    goland: "(|)",
  },
  {
    id: "10",
    name: ") overtypes an auto-inserted )",
    before: inFunc("\tf‸"),
    steps: [{ type: "()" }],
    after: inFunc("\tf()‸"),
    goland: "overtypes",
  },
  {
    id: "11",
    name: ") overtypes a hand-typed balanced )",
    before: inFunc("\tf(‸)"),
    steps: [{ type: ")" }],
    after: inFunc("\tf()‸"),
    goland: "overtypes (balance check only)",
  },
  {
    id: "12",
    name: ") inserts when the parens are unbalanced",
    before: inFunc("\tf((x‸)"),
    steps: [{ type: ")" }],
    after: inFunc("\tf((x)‸)"),
    goland: "inserts a new )",
  },
  {
    id: "13",
    name: "quote before an identifier",
    before: inFunc("\tx := ‸foo"),
    steps: [{ type: '"' }],
    after: inFunc('\tx := "‸foo'),
    goland: '"|foo, no closing quote',
  },
  {
    id: "14",
    name: "quote at line end pairs",
    before: inFunc("\tx := ‸"),
    steps: [{ type: '"' }],
    after: inFunc('\tx := "‸"'),
    goland: '"|"',
  },
  {
    id: "15",
    name: "quote overtypes the closing quote",
    before: inFunc('\tx := "abc‸"'),
    steps: [{ type: '"' }],
    after: inFunc('\tx := "abc"‸'),
    goland: "overtypes",
  },
  {
    id: "16",
    name: "escaped quote inside a string is literal",
    before: inFunc('\tx := "a‸b"'),
    steps: [{ type: String.raw`\"` }],
    after: inFunc('\tx := "a\\"‸b"'),
    goland: "inserted literally, no pair or overtype",
  },
  {
    id: "17",
    name: "backtick at line end pairs",
    before: inFunc("\tx := ‸"),
    steps: [{ type: "`" }],
    after: inFunc("\tx := `‸`"),
    goland: "`|` raw string pair",
  },
  {
    id: "18",
    name: "quote inside a raw string",
    before: inFunc("\tx := `a‸b`"),
    steps: [{ type: '"' }],
    after: inFunc('\tx := `a"‸b`'),
    goland: 'single ", no pair',
  },
  {
    id: "19",
    name: "( wraps a selection",
    before: inFunc("\tx := «foo»"),
    steps: [{ type: "(" }],
    after: inFunc("\tx := («foo»)"),
    goland: "(foo) with foo still selected, caret after foo",
  },
  {
    id: "22",
    name: "⌫ inside () removes both",
    before: inFunc("\tf(‸)"),
    steps: [{ press: "Backspace" }],
    after: inFunc("\tf‸"),
    goland: "both removed",
  },
  {
    id: "23",
    name: '⌫ inside "" removes both',
    before: inFunc('\tx := "‸"'),
    steps: [{ press: "Backspace" }],
    after: inFunc("\tx := ‸"),
    goland: "both removed",
  },
  {
    id: "24",
    name: "⌫ at the proper indent joins the previous line",
    before: inFunc("\ta := 1", "\t‸"),
    steps: [{ press: "Backspace" }],
    after: inFunc("\ta := 1‸"),
    goland: "joins: caret at the previous line's end",
  },
  {
    id: "25",
    name: "⌫ past the proper indent drops to it",
    before: inFunc("\ta := 1", "\t\t\t‸"),
    steps: [{ press: "Backspace" }],
    after: inFunc("\ta := 1", "\t‸"),
    goland: "indent becomes 1 tab, caret stays on the line",
  },
  {
    id: "26",
    name: "Enter between {} splits into three lines",
    before: file("func f() {‸}"),
    steps: [{ press: "Enter" }],
    after: file("func f() {", "\t‸", "}"),
    goland: "{ / indented caret line / }",
  },
  {
    id: "27",
    name: "Enter inside import () expands the block",
    before: file("package main", "", "import (‸)"),
    steps: [{ press: "Enter" }],
    after: file("package main", "", "import (", "\t‸", ")"),
    goland: "multi-line block, caret indented",
  },
  {
    id: "28",
    name: "Enter inside a string splits it",
    before: inFunc('\tx := "hello‸world"'),
    steps: [{ press: "Enter" }],
    after: inFunc('\tx := "hello" +', '\t\t"‸world"'),
    goland: '"hello" + then a new line "world"',
  },
  {
    id: "29",
    name: "Enter inside a raw string adds no indent",
    before: inFunc("\tx := `ab‸cd`"),
    steps: [{ press: "Enter" }],
    after: inFunc("\tx := `ab", "‸cd`"),
    goland: "newline, no indent",
  },
  {
    id: "30",
    name: "Enter inside a line comment continues it",
    before: inFunc("\t// some‸ text"),
    steps: [{ press: "Enter" }],
    after: inFunc("\t// some", "\t// ‸text"),
    goland: "next line starts with // and the rest",
  },
  {
    id: "31",
    name: "smart Home: indent, column 0, indent",
    before: inFunc("\t\tfoo‸"),
    steps: [{ pressTimes: ["Meta+ArrowLeft", 3] }],
    after: inFunc("\t\t‸foo"),
    goland: "⌘← toggles indent → col 0 → indent",
  },
  {
    id: "32",
    name: "Home on a whitespace-only line goes to column 0",
    before: inFunc("\ta := 1", "\t\t‸"),
    steps: [{ press: "Meta+ArrowLeft" }],
    after: inFunc("\ta := 1", "‸\t\t"),
    goland: "col 0",
  },
  {
    id: "33",
    name: "End stops before trailing spaces first",
    before: inFunc("‸\tfoo   "),
    steps: [{ press: "Meta+ArrowRight" }],
    after: inFunc("\tfoo‸   "),
    goland: "first ⌘→ lands after foo",
  },
  {
    id: "34",
    name: "End on an empty line stays put and edits nothing",
    before: inFunc("\ta := 1", "‸"),
    steps: [{ press: "Meta+ArrowRight" }],
    after: inFunc("\ta := 1", "‸"),
    goland: "differs on purpose: GoLand inserts the indent, Nyte never edits on a caret key",
  },
  {
    id: "35",
    name: "⌥→ stops inside a.b.c",
    before: inFunc("\t‸a.b.c"),
    steps: [{ pressTimes: ["Alt+ArrowRight", 3] }],
    after: inFunc("\ta.b‸.c"),
    goland: "stops after a, after ., after b",
  },
  {
    id: "36",
    name: "⌥→ at line end goes to the next line's first word",
    before: inFunc("\tfoo‸", "\tbar"),
    steps: [{ press: "Alt+ArrowRight" }],
    after: inFunc("\tfoo", "\t‸bar"),
    goland: "differs on purpose: GoLand stops at col 0, Nyte follows macOS word motion",
  },
  {
    id: "37",
    name: "⌥← at column 0 goes to the previous line's end",
    before: inFunc("\tfoo", "‸\tbar"),
    steps: [{ press: "Alt+ArrowLeft" }],
    after: inFunc("\tfoo‸", "\tbar"),
    goland: "end of the previous line",
  },
  {
    id: "38",
    name: "⌥→ treats userName as one word",
    before: inFunc("\t‸userName := 1"),
    steps: [{ press: "Alt+ArrowRight" }],
    after: inFunc("\tuserName‸ := 1"),
    goland: "one stop at the end of userName",
  },
  {
    id: "39",
    name: "↓ keeps the goal column across a short line",
    before: file("// 0123456789abcdefghij‸klmnop", "// abc", "// 0123456789abcdefghijklmnopqrs"),
    steps: [{ pressTimes: ["ArrowDown", 2] }],
    after: file("// 0123456789abcdefghijklmnop", "// abc", "// 0123456789abcdefghij‸klmnopqrs"),
    goland: "short line puts the caret at its end, the next returns to x of col 24",
  },
  {
    id: "40",
    name: "⇧↓ on the last line selects to the end",
    before: "\tfoo\n\tb‸ar",
    steps: [{ press: "Shift+ArrowDown" }],
    after: "\tfoo\n\tb«ar»",
    goland: "selects to document end",
  },
  {
    id: "41",
    name: "↑ on the first line goes to column 0",
    before: file("pack‸age main"),
    steps: [{ press: "ArrowUp" }],
    after: file("‸package main"),
    goland: "caret to col 0",
  },
  {
    id: "42",
    name: "→ collapses a selection to its end",
    before: inFunc("\tx := «foo» + 1"),
    steps: [{ press: "ArrowRight" }],
    after: inFunc("\tx := foo‸ + 1"),
    goland: "caret at selection end, no extra move",
  },
  {
    id: "43",
    name: "click past the line end",
    before: inFunc("‸\tfoo", "\tbar"),
    steps: [{ clickEnd: 5 }],
    after: inFunc("\tfoo", "\tbar‸"),
    goland: "caret at line end (no virtual space)",
  },
  {
    id: "45",
    name: "status bar column after a tab",
    before: inFunc("\t‸x"),
    steps: [],
    after: inFunc("\t‸x"),
    goland: "Col 5 (tab = 4 columns)",
  },
  {
    id: "46",
    name: "→ steps over an emoji in one press",
    before: inFunc('\tx := "a‸😀b"'),
    steps: [{ press: "ArrowRight" }, { type: "_" }],
    after: inFunc('\tx := "a😀_‸b"'),
    goland: "never inside the pair; the emoji is 1 column",
  },
  {
    id: "46b",
    name: "← steps over an emoji in one press",
    before: inFunc('\tx := "a😀‸b"'),
    steps: [{ press: "ArrowLeft" }, { type: "_" }],
    after: inFunc('\tx := "a_‸😀b"'),
    goland: "never inside the pair",
  },
  {
    id: "47",
    name: "a CRLF file stays CRLF after an edit",
    before: "package main\r\n\r\nvar a = 1‸\r\n",
    steps: [{ type: "2" }],
    after: "package main\r\n\r\nvar a = 12‸\r\n",
    goland: "kept as CRLF on save",
  },
  {
    id: "48",
    name: "⌘C with no selection pastes the line above",
    before: inFunc("\ta‸ := 1", "\tb := 2"),
    steps: [{ press: "Meta+c" }, { goTo: [5, 6] }, { press: "Meta+v" }],
    after: inFunc("\ta := 1", "\ta := 1", "\tb‸ := 2"),
    goland: String.raw`copies line\n; paste inserts it above the caret line`,
  },
  {
    id: "49",
    name: "three carets paste their own segments",
    before: inFunc("\t«one» = 1", "\t«two» = 2", "\t«six» = 6"),
    steps: [
      { press: "Meta+c" },
      { press: "Meta+ArrowRight" },
      { type: " // " },
      { press: "Meta+v" },
    ],
    after: inFunc("\tone = 1 // one‸", "\ttwo = 2 // two‸", "\tsix = 6 // six‸"),
    goland: "each caret gets its own segment",
  },
  {
    id: "52",
    name: "one line pastes into every caret",
    before: inFunc("\ta‸", "\tb‸", "\tc‸", "\td‸"),
    steps: [{ clipboard: "X" }, { press: "Meta+v" }],
    after: inFunc("\taX‸", "\tbX‸", "\tcX‸", "\tdX‸"),
    goland: "every caret gets the line",
  },
  {
    id: "56",
    name: "carets that meet merge",
    before: file("a‸b‸c"),
    steps: [{ pressTimes: ["ArrowLeft", 2] }, { type: "x" }],
    after: file("x‸abc"),
    goland: "merged into one caret",
  },
  {
    id: "58",
    name: "⌘D from a caret matches whole words",
    before: inFunc("\tid‸ := idx + id"),
    steps: [{ pressTimes: ["Meta+d", 2] }, { type: "k" }],
    after: inFunc("\tk‸ := idx + k‸"),
    goland: "VS Code ⌘D: first selects id, the next adds the next whole-word id, skipping idx",
  },
  {
    id: "59",
    name: "⌘D from a selection matches substrings",
    before: inFunc("\t«id» := idx + id"),
    steps: [{ press: "Meta+d" }, { type: "k" }],
    after: inFunc("\tk‸ := k‸x + id"),
    goland: "VS Code ⌘D: matches id inside idx (case-sensitive substring)",
  },
  {
    id: "62",
    name: "⌥⇧↓ on the last line without a newline",
    before: "var x = 1\nvar a‸ = 2",
    steps: [{ press: "Shift+Alt+ArrowDown" }],
    after: "var x = 1\nvar a = 2\nvar a‸ = 2",
    goland: "VS Code Copy Line Down: copy below, caret in the copy",
  },
  {
    id: "63",
    name: "⌘⇧K keeps the line a selection ends at column 0 of",
    before: file("l1", "«l2", "l3", "»l4"),
    steps: [{ press: "Meta+Shift+k" }],
    after: file("l1", "‸l4"),
    goland: "VS Code Delete Line: deletes l2 and l3, keeps l4",
  },
  {
    id: "64",
    name: "⌘/ twice toggles the same line back",
    before: inFunc("\ta‸ := 1", "\tb := 2"),
    steps: [{ pressTimes: ["Meta+Slash", 2] }],
    after: inFunc("\ta‸ := 1", "\tb := 2"),
    goland: "VS Code ⌘/: the caret stays, so the second press uncomments",
  },
  {
    id: "65",
    name: "⌘/ with a selection comments every line",
    before: inFunc("\ta «:= 1", "\tb :»= 2"),
    steps: [{ press: "Meta+Slash" }],
    after: inFunc("\t// a «:= 1", "\t// b :»= 2"),
    goland: "comments all selected lines, selection stays",
  },
  {
    id: "66",
    name: "⌥↓ moves a line into a block without re-indenting",
    before: inFunc("\ta‸ := 1", "\tif x {", "\t\tb := 2", "\t}"),
    steps: [{ press: "Alt+ArrowDown" }],
    after: inFunc("\tif x {", "\ta‸ := 1", "\t\tb := 2", "\t}"),
    goland: "VS Code Move Line Down; indentation unchanged, as GoLand's textual move",
  },
  {
    id: "x1",
    name: "typing x := 1 keeps the text exact",
    before: inFunc("\t‸"),
    steps: [{ type: "x := 1" }],
    after: inFunc("\tx := 1‸"),
    goland: "typed as is",
  },
  {
    id: "x2",
    name: "⌘Z after typing restores the text",
    before: inFunc("\ta := 1", "\t‸"),
    steps: [{ type: "b := 2" }, { press: "Meta+z" }],
    after: inFunc("\ta := 1", "\t‸"),
    goland: "one ⌘Z restores the text exactly",
  },
  {
    id: "x3",
    name: "⌘⇧Z redoes",
    before: inFunc("\t‸"),
    steps: [{ type: "abc" }, { press: "Meta+z" }, { press: "Meta+Shift+z" }],
    after: inFunc("\tabc‸"),
    goland: "redo brings the typing back",
  },
  {
    id: "x4",
    name: "Enter after { indents one tab",
    before: inFunc("\tif x {‸", "\t}"),
    steps: [{ press: "Enter" }],
    after: inFunc("\tif x {", "\t\t‸", "\t}"),
    goland: "smart indent: one tab deeper",
  },
  {
    id: "x5",
    name: "Tab inserts a tab",
    before: inFunc("‸x := 1"),
    steps: [{ press: "Tab" }],
    after: inFunc("\t‸x := 1"),
    goland: "inserts a tab character (Go uses tabs)",
  },
  {
    id: "x6",
    name: "⇧Tab removes one tab",
    before: inFunc("\t\tx‸ := 1"),
    steps: [{ press: "Shift+Tab" }],
    after: inFunc("\tx‸ := 1"),
    goland: "unindents the line by one tab",
  },
  {
    id: "x7",
    name: "⌘A then typing replaces everything",
    before: inFunc("\ta‸ := 1"),
    steps: [{ press: "Meta+a" }, { type: "z" }],
    after: "z‸",
    goland: "whole document replaced",
  },
  {
    id: "x8",
    name: "Delete at the line end joins lines",
    before: inFunc("\ta := 1‸", "\tb := 2"),
    steps: [{ press: "Delete" }],
    after: inFunc("\ta := 1‸\tb := 2"),
    goland: "deletes the line break only",
  },
  {
    id: "x9",
    name: "⌥⌫ deletes the previous word",
    before: inFunc("\tx := foo.bar‸"),
    steps: [{ press: "Alt+Backspace" }],
    after: inFunc("\tx := foo.‸"),
    goland: "deletes bar",
  },
  {
    id: "x10",
    name: "⌘⇧K deletes the line",
    before: inFunc("\ta := 1", "\tb‸ := 2", "\tc := 3"),
    steps: [{ press: "Meta+Shift+k" }],
    after: inFunc("\ta := 1", "\tc‸ := 3"),
    goland: "VS Code Delete Line; caret keeps its column",
  },
  {
    id: "x10b",
    name: "⌘⌫ deletes to the line start",
    before: inFunc("\ta := 1", "\tb‸ := 2", "\tc := 3"),
    steps: [{ press: "Meta+Backspace" }],
    after: inFunc("\ta := 1", "‸ := 2", "\tc := 3"),
    goland: "macOS / VS Code ⌘⌫: deletes from the caret to the line start",
  },
  {
    id: "x11",
    name: "⌥⇧↓ copies the line down",
    before: inFunc("\ta‸ := 1", "\tb := 2"),
    steps: [{ press: "Shift+Alt+ArrowDown" }],
    after: inFunc("\ta := 1", "\ta‸ := 1", "\tb := 2"),
    goland: "VS Code Copy Line Down: copy below, caret in the copy",
  },
  {
    id: "x12",
    name: "⌘D twice then typing edits both occurrences",
    before: inFunc("\tv := 1", "\tw := v‸ + v"),
    steps: [{ pressTimes: ["Meta+d", 2] }, { type: "n" }],
    after: inFunc("\tv := 1", "\tw := n‸ + n‸"),
    goland: "VS Code ⌘D: Add Selection to Next Find Match, then typed at both carets",
  },
  {
    id: "x13",
    name: "Escape with two carets leaves the newest",
    before: inFunc("\t‸a", "\t‸b"),
    steps: [{ press: "Escape" }, { type: "x" }],
    after: inFunc("\ta", "\tx‸b"),
    goland: "GoLand's docs keep the newest caret; its source keeps the oldest",
  },
  {
    id: "x14",
    name: "⌥↓ moves a line down",
    before: inFunc("\ta‸ := 1", "\tb := 2"),
    steps: [{ press: "Alt+ArrowDown" }],
    after: inFunc("\tb := 2", "\ta‸ := 1"),
    goland: "VS Code Move Line Down",
  },
  {
    id: "x15",
    name: "⌘/ comments at the indent column",
    before: inFunc("\tif x {", "\t\ta‸ := 1", "\t}"),
    steps: [{ press: "Meta+Slash" }],
    after: inFunc("\tif x {", "\t\t// a := 1", "\t}"),
    goland: "// at the indent column, not column 0",
  },
  {
    id: "x18",
    name: "⌥⇧I puts a caret at the end of each selected line",
    before: inFunc("\t«a := 1", "\tb := 2", "\tc := 3»"),
    steps: [{ press: "Shift+Alt+i" }, { type: ";" }],
    after: inFunc("\ta := 1;‸", "\tb := 2;‸", "\tc := 3;‸"),
    goland: "VS Code Add Cursors to Line Ends",
  },
];

const FOLDER = mkdtempSync(join(tmpdir(), "nyte-edges-"));

for (const edge of EDGES) writeFileSync(join(FOLDER, fileName(edge)), unmark(edge.before).text);

test.use({ opened: ["Code"], project: { edges: FOLDER } });

test.afterAll(() => rmSync(FOLDER, { recursive: true, force: true }));

test("editor edge cases against GoLand", async ({ desk }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const code = desk.page("Code");
  const results: Outcome[] = [];

  await closeWindow(desk.application, desk.page("Nyte"));
  await (
    await desk.application.browserWindow(code)
  ).evaluate((window) => window.setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
  await desk.front(code);

  for (const edge of EDGES) {
    const outcome = await runEdge(code, edge, {
      home: desk.home,
      clipboard: (value) =>
        desk.application.evaluate((electron, text) => electron.clipboard.writeText(text), value),
    }).catch((error: unknown) =>
      failed(edge, `harness: ${error instanceof Error ? error.message : String(error)}`),
    );

    results.push(outcome);
    process.stdout.write(`${report(outcome)}\n`);
  }

  const build = (await stat(BUILD)).mtime.toISOString();
  const body = JSON.stringify({ build, results }, null, 2);

  process.stdout.write(`renderer built ${build}\n`);

  await writeFile(testInfo.outputPath("edges.json"), body);
  await testInfo.attach("edges", { body, contentType: "application/json" });
  expect(results.flatMap((outcome) => (outcome.pass ? [] : [outcome.id]))).toEqual([]);
});

async function runEdge(
  page: Page,
  edge: Edge,
  context: { readonly home: string; readonly clipboard: (text: string) => Promise<void> },
): Promise<Outcome> {
  const before = unmark(edge.before);
  const want = unmark(edge.after);
  const path = `edges/${fileName(edge)}`;
  const notes: string[] = [];
  const text = await openPath(page, path);

  await text.click({ position: { x: 4, y: 4 } });
  const setup = await place(page, text, before);

  if (setup !== undefined) return failed(edge, `setup: ${setup}`);

  for (const step of edge.steps) await perform(page, text, step, context.clipboard);

  const strayed = await stray(page);
  const caret = (await status(page).textContent()) ?? "";
  const drawn = await drawnCarets(text);

  if (strayed) {
    notes.push("a palette, menu or dialog opened");
    await text.click({ position: { x: 4, y: 4 } });
  }

  if (!(await text.isVisible())) {
    notes.push("left the file");
    await openPath(page, path);
  }

  await page.keyboard.press("Meta+s");

  const saved = await page
    .getByRole("tab", { name: path, exact: true })
    .waitFor({ state: "visible", timeout: SAVED_MS })
    .then(() => true)
    .catch(() => false);

  if (!saved) notes.push("not saved");

  const got = await readFile(join(context.home, path), "utf8");
  const single = want.carets.length === 1 ? want.carets[0] : undefined;

  const wantCaret = single === undefined ? "" : statusText(want.text, single);
  const wantSelected = single !== undefined && single.anchor !== single.head;
  const caretPass = wantCaret === "" || caret === wantCaret;
  const selectedPass = single === undefined || drawn.selected === wantSelected;

  if (!selectedPass) notes.push(drawn.selected ? "a selection is left" : "the selection is gone");

  return {
    id: edge.id,
    name: edge.name,
    goland: edge.goland,
    pass: got === want.text && caretPass && selectedPass,
    got,
    want: want.text,
    caret,
    wantCaret,
    carets: drawn.carets,
    selected: drawn.selected,
    notes,
  };
}

async function openPath(page: Page, path: string): Promise<Locator> {
  await page.keyboard.press("Meta+p");
  const field = page.getByRole("combobox", { name: "Go to file" });

  await field.fill(path);
  await expect(page.getByRole("option", { name: path.split("/").at(-1) }).first()).toBeVisible();
  await field.press("Enter");
  const text = editor(page).getByRole("textbox", { name: path, exact: true });

  await expect(text).toBeVisible();

  return text;
}

async function place(page: Page, text: Locator, marked: Marked): Promise<string | undefined> {
  const first = marked.carets[0];

  if (first === undefined) return "the case has no caret";

  const start = spot(marked.text, first.anchor);

  await goTo(page, start.line, start.column);

  for (const extra of marked.carets.slice(1)) {
    const point = await pointAt(text, spot(marked.text, extra.anchor));

    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    await paint(page);
  }

  const span = selectionLength(marked.text, first);

  for (let step = 0; step < span; step += 1) await press(page, "Shift+ArrowRight");

  const last = marked.carets.at(-1) ?? first;
  const wanted = statusText(marked.text, last);
  const shown = (await status(page).textContent()) ?? "";
  const drawn = await drawnCarets(text);

  if (shown !== wanted) return `status ${shown}, wanted ${wanted}`;

  if (drawn.carets !== marked.carets.length) {
    return `${String(drawn.carets)} carets drawn, wanted ${String(marked.carets.length)}`;
  }

  return undefined;
}

async function perform(
  page: Page,
  text: Locator,
  step: Step,
  clipboard: (text: string) => Promise<void>,
): Promise<void> {
  if ("type" in step) {
    return page.keyboard.type(step.type, { delay: HOLD_MS }).then(() => paint(page));
  }

  if ("press" in step) return press(page, step.press);

  if ("pressTimes" in step) {
    for (let index = 0; index < step.pressTimes[1]; index += 1) {
      await press(page, step.pressTimes[0]);
    }

    return;
  }

  if ("clipboard" in step) return clipboard(step.clipboard);

  if ("goTo" in step) return goTo(page, step.goTo[0], step.goTo[1]);

  const end = await pointAt(text, { line: step.clickEnd, column: 0, character: Infinity });

  await page.mouse.click(end.x + 200, end.y);
  await paint(page);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key, { delay: HOLD_MS });
  await paint(page);
}

async function stray(page: Page): Promise<boolean> {
  const open = page
    .getByRole("combobox", { name: "Go to file" })
    .or(page.getByRole("dialog"))
    .or(page.getByRole("menu"));

  const found = await open.first().isVisible();

  for (let attempt = 0; attempt < 3 && (await open.first().isVisible()); attempt += 1) {
    await press(page, "Escape");
  }

  await expect(open.first()).toBeHidden();

  return found;
}

function status(page: Page): Locator {
  return editor(page).getByRole("button", { name: STATUS });
}

function drawnCarets(text: Locator): Promise<Pick<Outcome, "carets" | "selected">> {
  return text.evaluate((node) => {
    const root = node.getRootNode();

    if (!(root instanceof ShadowRoot)) throw new Error("The editor isn't in a shadow root.");

    return {
      carets: root.querySelectorAll("[data-caret]").length,
      selected: root.querySelectorAll("[data-selection-range]").length > 0,
    };
  });
}

function pointAt(text: Locator, at: Spot): Promise<{ readonly x: number; readonly y: number }> {
  return text.evaluate((node, target) => {
    const row = node.querySelector(`[data-line="${String(target.line)}"]`);

    if (row === null) throw new Error(`Line ${String(target.line)} isn't drawn.`);
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const box = row.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const range = document.createRange();
    let remaining = target.character;
    let last: Node | null = null;

    for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
      const length = current.textContent?.length ?? 0;

      if (remaining < length) {
        range.setStart(current, remaining);
        range.setEnd(current, remaining + 1);

        return { x: range.getBoundingClientRect().left + 1, y: middle };
      }

      remaining -= length;
      last = current;
    }

    if (last === null) return { x: box.left + 2, y: middle };
    range.selectNodeContents(last);

    return { x: range.getBoundingClientRect().right + 1, y: middle };
  }, at);
}

async function paint(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

function unmark(marked: string): Marked {
  const carets: Caret[] = [];
  let text = "";
  let anchor = 0;

  for (const char of marked) {
    if (char === "‸") carets.push({ anchor: text.length, head: text.length });
    else if (char === "«") anchor = text.length;
    else if (char === "»") carets.push({ anchor, head: text.length });
    else text += char;
  }

  return { text, carets };
}

function spot(text: string, offset: number): Spot {
  const before = text.slice(0, offset);
  const prefix = before.slice(before.lastIndexOf("\n") + 1);

  return {
    line: before.split("\n").length,
    column: visualColumn(prefix) + 1,
    character: prefix.length,
  };
}

function statusText(text: string, caret: Caret): string {
  const head = spot(text, caret.head);
  const anchor = spot(text, caret.anchor);

  if (head.line !== anchor.line) {
    const end = head.line > anchor.line ? head : anchor;
    const lines = Math.abs(head.line - anchor.line) + (end.character === 0 ? 0 : 1);

    return `${String(lines)} lines selected`;
  }

  return `Ln ${String(head.line)}, Col ${String(head.column)}`;
}

function selectionLength(text: string, caret: Caret): number {
  return Array.from(text.slice(caret.anchor, caret.head).replaceAll("\r\n", "\n")).length;
}

function visualColumn(prefix: string): number {
  let column = 0;

  for (const char of prefix) {
    column = char === "\t" ? column + TAB_COLUMNS - (column % TAB_COLUMNS) : column + 1;
  }

  return column;
}

function fileName(edge: Edge): string {
  return `e${edge.id.padStart(2, "0")}.go`;
}

function failed(edge: Edge, note: string): Outcome {
  return {
    id: edge.id,
    name: edge.name,
    goland: edge.goland,
    pass: false,
    got: "",
    want: unmark(edge.after).text,
    caret: "",
    wantCaret: "",
    carets: 0,
    selected: false,
    notes: [note],
  };
}

function report(outcome: Outcome): string {
  const head = `${outcome.pass ? "PASS" : "FAIL"} ${outcome.id} ${outcome.name}`;
  const notes = outcome.notes.length > 0 ? ` [${outcome.notes.join("; ")}]` : "";

  if (outcome.pass) return `${head}${notes}`;

  return `${head} got ${JSON.stringify(outcome.got)} ${outcome.caret} (${String(outcome.carets)} carets${outcome.selected ? ", selected" : ""}) want ${JSON.stringify(outcome.want)} ${outcome.wantCaret}${notes}`;
}
