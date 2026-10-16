import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await test("lookup-name lint rejects helpers and accepts operations and native indexOf", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-lookup-lint-"));

  try {
    const config = join(directory, "oxlintrc.json");
    await writeFile(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [fileURLToPath(new URL("../index.ts", import.meta.url))],
        rules: { "anti-slop/no-of-lookup-names": "error" },
      }),
    );

    const rejected = join(directory, "rejected.ts");
    const accepted = join(directory, "accepted.ts");
    await writeFile(
      rejected,
      `function indexOf(state: FoldState): Index {
  const index = indexes.get(state.messages);
  if (index === undefined)
    throw new SdkError("internal", "The fold state was not made by emptyFold or fold.");
  return index;
}
async function stopReceipt<O extends Json>(outcomeOf: (value: Json) => O) {}
const keyOf = (value: Entry) => value.id;
const childOf = ((value: Entry) => value.child) satisfies (value: Entry) => Entry;
const read = function partOf(value: Entry) { return value.part; };
const helpers = {
  modelOf(value: Entry) { return value.model; },
  "headOf": (value: Entry) => value.head,
  ["sessionOf"]: (value: Entry) => value.session,
  taskOf: function(value: Entry) { return value.task; },
};
class Helpers {
  refOf(value: Entry) { return value.ref; }
  messageOf = (value: Entry) => value.message;
  #stateOf = (value: Entry) => value.state;
}
declare function pathOf(value: Entry): string;`,
    );
    await writeFile(
      accepted,
      `function findPart(state: FoldState) { return state.parts.get("a"); }
const readChild = (value: Entry) => value.child;
function stopReceipt(decodeOutcome: (value: Json) => Json) {}
const helpers = { indexOf: 2, partOf: "part", findModel(value: Entry) { return value.model; } };
const [headOf] = tuple;
const property = "keyOf";
const computed = { [property]: (value: Entry) => value.id };
const index = messages.indexOf(message);
const offset = text.indexOf("/");
const proofOfConcept = (value: Entry) => value;
const instanceOf = true;`,
    );

    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../../../../node_modules/oxlint/bin/oxlint", import.meta.url)),
        "--config",
        config,
        "--format",
        "json",
        rejected,
        accepted,
      ],
      { encoding: "utf8" },
    );

    equal(result.error, undefined);
    equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    deepEqual(
      report.diagnostics
        .map((diagnostic) => diagnostic.message.match(/Rename "([^"]+)"/)?.[1])
        .sort(),
      [
        "indexOf",
        "outcomeOf",
        "keyOf",
        "childOf",
        "partOf",
        "modelOf",
        "headOf",
        "sessionOf",
        "taskOf",
        "refOf",
        "messageOf",
        "stateOf",
        "pathOf",
      ].sort(),
    );
    equal(
      report.diagnostics.every((diagnostic) => diagnostic.filename === rejected),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
