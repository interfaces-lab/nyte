import { writeFileSync } from "node:fs";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk";

const [session = "", output = "", count = "0", every = "250"] = process.argv.slice(2);

const host = await sdk.open({
  home: process.env.HOME,
  label: "writer",
  workspace: { kind: "local", path: process.cwd() },
});

const head = host.session(asId<"session">(session));

const sent: Record<string, number> = {};

for (let index = 1; index <= Number(count); index += 1) {
  await head.send(`VIS ${String(index)}`, { delivery: "queue" });
  sent[`VIS ${String(index)}`] = Date.now();
  await new Promise((done) => setTimeout(done, Number(every)));
}

writeFileSync(output, JSON.stringify(sent));

await host.close();
