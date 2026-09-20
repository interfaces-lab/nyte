/**
 * Pierre emits the collapsed-context row once per grid column. The count and
 * the expand controls are drawn in the gutter copy, which Pierre pins and
 * stacks above the code while it scrolls, and allowed to overflow across the
 * band the two copies form. An upgrade that renames those attributes has to
 * fail here rather than silently render an empty band, a double-painted tint,
 * or two sets of buttons.
 */
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { DiffView } from "./diff-view.tsx";
import { createDiffFilesLoader } from "./diff-expansion.ts";
import "../theme/tokens.css";

const PATCH = `--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -40,3 +40,3 @@
 forty
-fortyone
+FORTYONE
 fortytwo
`;

/** A patch whose gap is short enough for one expansion to close it. */
const SHORT_GAP_PATCH = `--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -14,3 +14,3 @@
 fourteen
-fifteen
+FIFTEEN
 sixteen
`;

/** The file the patch was cut from: 42 lines, of which 36 are collapsed away. */
function wholeFile(secondLine: string, lastButOne: string): string {
  const middle = Array.from({ length: 36 }, (_, index) => `line${String(index + 4)}`);
  return [`one`, secondLine, `three`, ...middle, `forty`, lastButOne, `fortytwo`, ``].join("\n");
}

function shortFile(secondLine: string, lastButOne: string): string {
  const middle = Array.from({ length: 10 }, (_, index) => `line${String(index + 4)}`);
  return [`one`, secondLine, `three`, ...middle, `fourteen`, lastButOne, `sixteen`, ``].join("\n");
}

const loadDiffFiles = createDiffFilesLoader({
  root: "/repo",
  revision: "abc123",
  scope: { kind: "worktree" },
  readContents: () =>
    Promise.resolve({
      path: "app.ts",
      old: wholeFile("two", "fortyone"),
      new: wholeFile("TWO", "FORTYONE"),
      binary: false,
      truncated: false,
    }),
});

const loadShortFile = createDiffFilesLoader({
  root: "/repo",
  revision: "abc123",
  scope: { kind: "worktree" },
  readContents: () =>
    Promise.resolve({
      path: "app.ts",
      old: shortFile("two", "fifteen"),
      new: shortFile("TWO", "FIFTEEN"),
      binary: false,
      truncated: false,
    }),
});

function mount(node: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.style.width = "784px";
  document.body.append(host);
  createRoot(host).render(node);
  return host;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1500));

export async function run(): Promise<string> {
  const host = mount(
    <DiffView
      path="app.ts"
      diff={{ patch: PATCH, added: 2, removed: 2 }}
      variant="stack"
      loadDiffFiles={loadDiffFiles}
    />,
  );
  const plain = mount(
    <DiffView path="app.ts" diff={{ patch: PATCH, added: 2, removed: 2 }} variant="stack" />,
  );
  const shortGap = mount(
    <DiffView
      path="app.ts"
      diff={{ patch: SHORT_GAP_PATCH, added: 1, removed: 1 }}
      variant="stack"
      loadDiffFiles={loadShortFile}
    />,
  );
  await settle();

  const root = host.querySelector("diffs-container")?.shadowRoot;
  const plainRoot = plain.querySelector("diffs-container")?.shadowRoot;
  const shortRoot = shortGap.querySelector("diffs-container")?.shadowRoot;
  if (root == null || plainRoot == null || shortRoot == null) return "no shadow root";

  const row = root.querySelector("[data-content] [data-separator]");
  const label = root.querySelector("[data-gutter] [data-unmodified-lines]");
  const gutterBand = root.querySelector("[data-gutter] [data-separator-content]");
  const band = root.querySelector("[data-content] [data-separator-content]");
  if (row === null || label === null || gutterBand === null || band === null) return "no band";

  // Scoped to this gap: the diff also carries a trailing "more context may be
  // available" separator with its own control.
  const gutterRow = root.querySelector("[data-gutter] [data-separator]");
  const buttons = [...(gutterRow?.querySelectorAll("[data-expand-button]") ?? [])].filter(
    (button) => button.getBoundingClientRect().width > 0,
  );
  const contentButtons = [...row.querySelectorAll("[data-expand-button]")].filter(
    (button) => button.getBoundingClientRect().width > 0,
  );
  const first = buttons[0];
  if (first === undefined) return "no expand button";

  const labelBox = label.getBoundingClientRect();
  const gutterBox = gutterBand.getBoundingClientRect();
  const bandBox = band.getBoundingClientRect();
  const lastButton = buttons[buttons.length - 1]?.getBoundingClientRect();
  const firstButtonBox = first.getBoundingClientRect();
  const onTop = root.elementFromPoint(labelBox.left + 4, labelBox.top + labelBox.height / 2);
  const linesBefore = root.querySelectorAll("[data-content] [data-line]").length;

  first.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await settle();
  const expanded = root.querySelector("[data-gutter] [data-unmodified-lines]");
  const linesAfter = root.querySelectorAll("[data-content] [data-line]").length;

  return [
    `label=${JSON.stringify(label.textContent)}`,
    // Nothing may cover the count, and the two tinted halves must meet exactly
    // rather than overlap, which would paint the fill twice.
    `labelOnTop=${onTop?.hasAttribute("data-unmodified-lines") === true}`,
    `bandsMeet=${Math.abs(gutterBox.right - bandBox.left) < 1}`,
    `bandHeight=${Math.round(bandBox.height)}`,
    // The stack's height arithmetic depends on whole line boxes.
    `rowIsWholeRows=${row.getBoundingClientRect().height % 20 === 0}`,
    // One set of controls, at the leading edge of the band, clear of the count.
    `buttons=${String(buttons.length)}/${String(contentButtons.length)}`,
    `buttonsLeadBand=${Math.abs(firstButtonBox.left - gutterBox.left) < 1}`,
    `countClearsButtons=${lastButton !== undefined && labelBox.left >= lastButton.right}`,
    // A click pulls in one expansion's worth of the file and leaves the rest.
    `expanded=${JSON.stringify(expanded?.textContent ?? null)}`,
    `linesGrew=${linesAfter > linesBefore}`,
    // Without a loader there is nothing to pull in, so no control is offered.
    `plainButtons=${String(plainRoot.querySelectorAll("[data-expand-button]").length)}`,
    // A gap one expansion can close offers the stacked pair, not up and down.
    `shortGapButtons=${String(
      [
        ...(shortRoot
          .querySelector("[data-gutter] [data-separator]")
          ?.querySelectorAll("[data-expand-button]") ?? []),
      ].filter((button) => button.getBoundingClientRect().width > 0).length,
    )}`,
  ].join(" ");
}
