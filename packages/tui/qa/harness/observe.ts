import { writeFileSync } from "node:fs";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";
import { connect, createSendJournal, headView } from "@nyte-ai/sdk/client";

const [session = "", output = "", expected = "0"] = process.argv.slice(2);

const host = await sdk.open({
  home: process.env.HOME,
  label: "observer",
  workspace: { kind: "local", path: process.cwd() },
});

const token = crypto.randomUUID();

const listener = await host.listen({
  transport: { kind: "http", hostname: "127.0.0.1", port: 0 },
  auth: { kind: "token", token },
});

if (listener.address === null) throw new Error("The observer isn't listening.");

const live = await connect({
  url: listener.address,
  credentials: { kind: "token", token },
  client: { kind: "other", name: "observer", version: "0.0.0" },
  journal: createSendJournal(),
});

const head = live.head(asId<"session">(session), asId<"head">("main"), { tail: 200 });

const seen = new Map<string, number>();

const all = Promise.withResolvers<void>();

const check = (): void => {
  const snapshot = head.snapshot();

  for (const message of snapshot === null ? [] : headView(snapshot).messages) {
    if (
      message.kind === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith("VIS ") &&
      !seen.has(message.content)
    ) {
      seen.set(message.content, Date.now());
    }
  }

  if (seen.size >= Number(expected)) all.resolve();
};

head.subscribe(check);

check();

process.stdout.write("observing\n");

const deadline = AbortSignal.timeout(120_000);

await Promise.race([
  all.promise,
  new Promise((done) => deadline.addEventListener("abort", done, { once: true })),
]);

writeFileSync(output, JSON.stringify(Object.fromEntries(seen)));

head.close();

await live.close();

await host.close();
