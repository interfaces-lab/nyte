import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { UserMessageText } from "./message-content.tsx";

test("a TUI skill invocation renders as a compact skill chip", () => {
  const source = [
    '<skill name="review" location="/Users/me/.agents/skills/review/SKILL.md">',
    "References are relative to /Users/me/.agents/skills/review.",
    "",
    "# Review",
    "Inspect every changed file.",
    "</skill>",
    "",
    "Fix the regression.",
  ].join("\n");

  const html = renderToStaticMarkup(<UserMessageText text={source} />);

  expect(html).toContain('data-composer-chip="skill"');
  expect(html).toContain("/review");
  expect(html).toContain("Fix the regression.");
  expect(html).not.toContain("References are relative");
  expect(html).not.toContain("Inspect every changed file");
});
