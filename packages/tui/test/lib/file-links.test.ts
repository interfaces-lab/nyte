import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";
import { linkFilePaths } from "../../src/lib/file-links.ts";

const fileUrl = (path: string): string => pathToFileURL(path).href;

test("a path in inline code links to the file under the root, outside the sentence's period", () => {
  expect(linkFilePaths("The film is `out/film.mp4`. Old: `/tmp/old.mp4`.", "/repo")).toBe(
    `The film is [\`out/film.mp4\`](${fileUrl("/repo/out/film.mp4")}). Old: [\`/tmp/old.mp4\`](${fileUrl("/tmp/old.mp4")}).`,
  );
});

test("a line suffix and the home folder resolve to the file", () => {
  expect(linkFilePaths("`src/app.ts:42:7` `~/notes/a.md`", "/repo")).toBe(
    `[\`src/app.ts:42:7\`](${fileUrl("/repo/src/app.ts")}) [\`~/notes/a.md\`](${fileUrl(join(homedir(), "notes/a.md"))})`,
  );
});

test("code that isn't a file path stays as written", () => {
  const text =
    "`/studio` `server/*` `@opentui/core` `https://x.io/a.js` `node:path` `app.ts` `src/` `a b/c.ts` `process.cwd`";

  expect(linkFilePaths(text, "/repo")).toBe(text);
});

test("paths in lists and tables link; code blocks and link labels stay as written", () => {
  const text = [
    "- one `a/b.ts` and [`q/r.ts`](u) then `q/r.ts`",
    "  more `c/d.ts`",
    "",
    "```",
    "`in/code.ts`",
    "```",
    "",
    "| `t/c.ts` | x |",
    "|---|---|",
  ].join("\n");

  expect(linkFilePaths(text, "/repo")).toBe(
    [
      `- one [\`a/b.ts\`](${fileUrl("/repo/a/b.ts")}) and [\`q/r.ts\`](u) then [\`q/r.ts\`](${fileUrl("/repo/q/r.ts")})`,
      `  more [\`c/d.ts\`](${fileUrl("/repo/c/d.ts")})`,
      "",
      "```",
      "`in/code.ts`",
      "```",
      "",
      `| [\`t/c.ts\`](${fileUrl("/repo/t/c.ts")}) | x |`,
      "|---|---|",
    ].join("\n"),
  );
});
