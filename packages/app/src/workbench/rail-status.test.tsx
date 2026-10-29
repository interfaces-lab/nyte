import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { GitStatus } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { ChangesRow } from "./rail-status.tsx";

type Repository = Extract<GitStatus, { readonly kind: "repository" }>;

const clean: Repository = {
  kind: "repository",
  root: "/repo",
  head: asId<"git-commit">("abc1234"),
  branch: "main",
  upstream: null,
  revision: asId<"git-revision">("r1"),
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
};

function label(head: Repository): string {
  return renderToStaticMarkup(<ChangesRow head={head} onOpen={() => undefined} />)
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

test("the Changes rail row shows the working tree's line totals", () => {
  const edited: Repository = {
    ...clean,
    staged: [{ path: "a.ts", status: "modified", added: 10, removed: 2 }],
    unstaged: [{ path: "b.ts", status: "modified", added: 2, removed: 1 }],
  };

  expect(label(edited)).toBe("Changes + 12 - 3");
  expect(label({ ...clean, untracked: ["new.ts"] })).toBe("1 changed file");
  expect(label(clean)).toBe("No changes");
});
