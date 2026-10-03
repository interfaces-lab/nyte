import { createModels } from "@nyte-ai/ai/models";
import { FileCredentialStore } from "@nyte-ai/ai/auth/store";
import { openaiCodexProvider } from "@nyte-ai/ai/providers/openai-codex";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const { values } = parseArgs({ options: { model: { type: "string", default: "gpt-6.1-sol" } } });
const credentials = new FileCredentialStore();
const models = createModels({ credentials });
models.setProvider(openaiCodexProvider());
const signal = AbortSignal.timeout(30_000);
await models.refresh({ providers: ["openai-codex"], signal });
const model = models.getModel("openai-codex", values.model);
if (model === undefined) {
  throw new Error("Select a Codex model in Nyte's catalog with --model");
}
const auth = await models.getAuth("openai-codex", { signal });
const credential = await credentials.read("openai-codex");
if (!auth?.auth.apiKey || credential?.type !== "oauth") {
  throw new Error("Sign in to OpenAI Codex in the Nyte desktop first");
}
const tokenFile = new URL("../.nyte-token.local", import.meta.url);
const token = (
  await readFile(tokenFile, "utf8").catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return randomBytes(24).toString("hex");
    throw cause;
  })
).trim();
await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
await writeFile(
  new URL("../.dev.vars", import.meta.url),
  `NYTE_TOKEN=${JSON.stringify(token)}\nOPENAI_CODEX_ACCESS_TOKEN=${JSON.stringify(auth.auth.apiKey)}\n`,
  { mode: 0o600 },
);
await writeFile(new URL("../model.json", import.meta.url), `${JSON.stringify(model, null, 2)}\n`);
console.log(`Local Codex token synced. Expires ${new Date(credential.expires).toISOString()}.`);
