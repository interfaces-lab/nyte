import { writeFileSync } from "node:fs";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";

const [session = "", output = "", expected = "0"] = process.argv.slice(2);

const host = await sdk.open({
  home: process.env.HOME,
  label: "observer",
  workspace: { kind: "local", path: process.cwd() },
});

const head = host.session(asId<"session">(session));

const seen = new Map<string, number>();

const check = (): void => {
  for (const message of head.current()?.messages ?? [])
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

await host.close();
