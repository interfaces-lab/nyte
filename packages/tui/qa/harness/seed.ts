import process from "node:process";
import { sdk } from "@nyte-ai/sdk";

const host = await sdk.open({
  home: process.env.HOME,
  workspace: { kind: "local", path: process.cwd() },
});

const login = host.models.login({
  provider: "anthropic",
  method: { kind: "key" },
  label: "Harness",
});

for await (const step of login.steps()) {
  if (step.kind === "paste") await login.answer("sk-harness");

  if (step.kind === "failed") throw new Error(step.reason);
}

await host.models.setDefault({ provider: "anthropic", id: "scripted" });

process.stdout.write(`${JSON.stringify((await host.models.list()).default)}\n`);

await host.close();
