import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@nyte-ai/ai/models";
import { composeServer } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import { sqliteStore } from "../../src/store/sqlite.ts";
import { localMachine } from "../../src/local/process/machine.ts";
import { localProvider } from "../../src/local/provider.ts";
import { acpAgents } from "@nyte-ai/plugin/core/acp";

const directory = process.argv[2];

const mode = process.argv[3];

if (!directory || !["dispatch", "recover"].includes(mode)) {
  throw new Error("Missing crash fixture arguments.");
}
const store = sqliteStore({ path: join(directory, "crash.db") });

const { host } = await composeServer({
  store,
  member: { label: "ACP crash fixture", pid: process.pid, machine: localMachine, capabilities: [] },
  models: createModels(),
  plugins: [
    { id: "local", environment: localProvider({ home: directory }) },
    ...acpAgents([
      {
        id: "fake",
        name: "Fake Agent",
        command: process.execPath,
        env: { ACP_LOG: join(directory, "log") },
        launch: {
          args: [
            fileURLToPath(new URL("../../../plugin/test/fixtures/acp-agent.mjs", import.meta.url)),
          ],
        },
      },
    ]),
  ],
  workspace: { kind: "local", path: directory },
  home: null,
  description: { name: "fixture", platform: "darwin", version: "1" },
});

const main = asId("main");

if (mode === "dispatch") {
  const { session, receipt } = await host.sessions.start({
    content: "first",
    configuration: { model: { provider: "fake", id: "fake" } },
  });

  if ((await receipt.settled()).kind !== "completed") {
    throw new Error("The clean fixture prompt failed.");
  }
  const changed = Promise.withResolvers();

  const watcher = watch(directory, () => {
    void readFile(join(directory, "effect"), "utf8").then(
      (text) => {
        if (text === "charged\n") changed.resolve();
      },
      () => {},
    );
  });

  const sent = await session.head(main).send("charge-once");
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify({ session: session.id, receipt: sent.id }),
  );
  await changed.promise;
  watcher.close();
  process.send?.({ kind: "effect-observed" });
} else {
  const saved = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"));

  if (typeof saved.session !== "string" || typeof saved.receipt !== "string") {
    throw new Error("Malformed crash receipt.");
  }
  const session = host.session(asId(saved.session));
  await host.execution.advance({ session: session.id, head: main });
  const outcome = await session.receipt(asId(saved.receipt)).settled();
  const effects = await readFile(join(directory, "effect"), "utf8");
  await host.close();
  process.send?.({ kind: "recovered", outcome, effects });
  process.disconnect?.();
}
