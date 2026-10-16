import { sqliteStore } from "./src/sqlite.ts";

const path = process.argv[2] ?? "";
const started = performance.now();
const store = sqliteStore({ path });

try {
  const { objects, refs } = await store.open();
  const opened = Math.round(performance.now() - started);
  const sessions = (await refs.list("sessions/")).filter((ref) => ref.name.split("/").length === 2);
  const first = sessions[0];
  const record = first?.target ? await objects.get(first.target) : null;
  const target = await objects.put({ probe: process.pid });
  const written = await refs.set([{ name: `kv/probe/${process.pid}`, target }]);

  console.log(
    JSON.stringify({
      runtime: typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`,
      openedMs: opened,
      sessions: sessions.length,
      readSession: record !== null,
      write: written.kind,
    }),
  );
} catch (error) {
  console.log(JSON.stringify({ crashed: String(error) }));
  process.exitCode = 1;
} finally {
  await store.close();
}
