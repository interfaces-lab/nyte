import { createRoot } from "react-dom/client";
import { DiffView } from "./diff-view.tsx";
import { createDiffFilesLoader } from "./diff-expansion.ts";
import "../theme/tokens.css";

const PATCH =
  "--- a/app.ts\n+++ b/app.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n@@ -40,3 +40,3 @@\n forty\n-fortyone\n+FORTYONE\n fortytwo\n";
const wholeFile = (second: string, last: string): string =>
  [
    "one",
    second,
    "three",
    ...Array.from({ length: 36 }, (_, index) => `line${index + 4}`),
    "forty",
    last,
    "fortytwo",
    "",
  ].join("\n");

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Context expansion did not render");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export async function run(): Promise<string> {
  const host = document.createElement("div");
  host.style.width = "784px";
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <DiffView
        path="app.ts"
        diff={{ patch: PATCH, added: 2, removed: 2 }}
        variant="stack"
        loadDiffFiles={createDiffFilesLoader({
          root: "/repo",
          revision: "revision",
          scope: { kind: "worktree" },
          readContents: async () => ({
            path: "app.ts",
            old: { kind: "text", text: wholeFile("two", "fortyone") },
            new: { kind: "text", text: wholeFile("TWO", "FORTYONE") },
          }),
        })}
      />,
    );
    const shadow = () => host.querySelector("diffs-container")?.shadowRoot;
    await until(() => shadow()?.querySelector("[data-expand-button]") instanceof Element);
    if (shadow()?.textContent?.includes("line20"))
      throw new Error("Context should start collapsed");
    const button = Array.from(shadow()?.querySelectorAll("[data-expand-button]") ?? []).find(
      (element) => element.getBoundingClientRect().width > 0,
    );
    if (button === undefined) throw new Error("No visible expansion control");
    const box = button.getBoundingClientRect();
    const target = shadow()?.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await until(() => shadow()?.textContent?.includes("line20") === true);
    return "passed";
  } finally {
    root.unmount();
    host.remove();
  }
}
