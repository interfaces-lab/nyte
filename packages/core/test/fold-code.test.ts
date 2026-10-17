import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { FOLD_CODE } from "../src/fold/code.ts";

it("stamps fold checkpoints with the hash of the fold code", async () => {
  const folder = new URL("../src/fold/", import.meta.url);
  const hash = createHash("sha256");
  const names = (await readdir(folder)).filter(
    (name) => name.endsWith(".ts") && name !== "code.ts",
  );

  for (const name of names.toSorted())
    hash
      .update(`${name}\0`)
      .update(await readFile(new URL(name, folder)))
      .update("\0");

  expect(
    hash.digest("hex").slice(0, 16),
    "The fold code changed, so checkpoints it wrote before may fold differently. Update FOLD_CODE in src/fold/code.ts to this hash.",
  ).toBe(FOLD_CODE);
});
