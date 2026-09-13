import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { UserMessageText } from "./message-content.tsx";
import { ReferenceOpenerProvider } from "./reference-opener.tsx";
import "../theme/tokens.css";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function paint(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
export async function run(): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  const input = document.createElement("input");
  document.body.append(input);
  input.value = "keep selection";
  input.focus();
  input.setSelectionRange(2, 5);
  const root = createRoot(host);
  let opened = 0;
  let edited = 0;
  const render = (text: string): void =>
    flushSync(() =>
      root.render(
        <ReferenceOpenerProvider
          value={() => () => {
            opened += 1;
          }}
        >
          <div
            onClick={() => {
              edited += 1;
            }}
          >
            <UserMessageText text={text} />
          </div>
        </ReferenceOpenerProvider>,
      ),
    );
  try {
    render(
      '<skill name="review" location="/skills/review/SKILL.md">\nHidden instructions\n</skill>\n\nFix the regression. https://example.com/test',
    );
    await paint();
    check(
      host.querySelector('[data-composer-readonly][contenteditable="false"]') !== null,
      "read-only Lexical root",
    );
    check(host.textContent?.includes("/review") === true, "skill invocation renders a chip");
    check(!host.textContent?.includes("Hidden instructions"), "instructions stay hidden");
    check(
      host.querySelector('[data-composer-chip="skill"] button') === null,
      "readonly has no remove control",
    );
    check(
      document.activeElement === input && input.selectionStart === 2 && input.selectionEnd === 5,
      "render does not steal focus or selection",
    );
    const chip = host.querySelector('[data-composer-chip="skill"]');
    if (!(chip instanceof HTMLElement)) throw new Error("missing chip");
    chip.click();
    check(opened === 1 && edited === 0, "chip opens without editing message");
    const link = host.querySelector("a");
    if (!(link instanceof HTMLAnchorElement)) throw new Error("missing URL link");
    check(link.href === "https://example.com/test", "link destination survives rendering");
    link.click();
    check(edited === 0, "link does not edit message");
    const links: unknown = Reflect.get(window, "openedLinks");
    check(
      Array.isArray(links) && links[0] === "https://example.com/test",
      "URL opens through host",
    );
    render("/unfinished\n\n\n  plain text  ");
    await paint();
    check(host.querySelector("[data-composer-chip]") === null, "unselected slash text stays text");
    check(host.textContent?.includes("  plain text  ") === true, "inline whitespace survives");
    check(host.querySelector("a") === null, "stale links removed on content replacement");
    render("[$review](/skills/review/SKILL.md)");
    await paint();
    check(host.textContent === "/review", "skill-only content is not trimmed away");
    render("x".repeat(100_001));
    await paint();
    check(
      host.textContent === "Message is too long to display",
      "oversized messages avoid mounting Lexical",
    );
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    input.remove();
  }
}
