import { writeFileSync } from "node:fs";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";
import { headView, openHost } from "@nyte-ai/sdk/client";

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

const live = openHost(listener.address, {
  credentials: { kind: "token", token },
  client: { kind: "other", name: "observer", version: "0.0.0" },
});

const head = live.head(asId<"session">(session), asId<"head">("main"), { tail: 200 });

const seen = new Map<string, number>();

const check = (): void => {
  const snapshot = head.snapshot();

  for (const message of snapshot === null ? [] : headView(snapshot).messages)
    if (
      message.kind === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith("VIS ") &&
      !seen.has(message.content)
    )
      seen.set(message.content, Date.now());
};

head.subscribe(check);

check();

process.stdout.write("observing\n");

const deadline = Date.now() + 120_000;

while (seen.size < Number(expected) && Date.now() < deadline)
  await new Promise((done) => setTimeout(done, 50));

writeFileSync(output, JSON.stringify(Object.fromEntries(seen)));

head.close();

live.release();

await host.close();
