import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createModels, FileCredentialStore, openaiCodexProvider } from "@nyte-ai/ai";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "gpt-5.6-sol" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`Usage: pnpm sync:codex [--model <codex-model-id>]

Copies the current Nyte Codex OAuth access token to the linked nyte-server
Vercel project's Production environment and sets NYTE_MODEL.
The refresh token stays in the local Nyte credential store.
Run pnpm run deploy afterward. Repeat when the deployed access token expires.`);
} else {
  try {
    const root = new URL("../", import.meta.url);
    const project: unknown = JSON.parse(
      await readFile(new URL(".vercel/project.json", root), "utf8"),
    );
    if (
      typeof project !== "object" ||
      project === null ||
      !("projectName" in project) ||
      project.projectName !== "nyte-server"
    )
      throw new Error("Link this package to the nyte-server Vercel project before syncing Codex.");

    const credentials = new FileCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(openaiCodexProvider());
    if (!models.getModel("openai-codex", values.model))
      throw new Error("The selected Codex model is not in Nyte's catalog.");
    // Refresh under the local store lock before copying only the short-lived access token.
    const auth = await models
      .getAuth("openai-codex", { signal: AbortSignal.timeout(30_000) })
      .catch(() => {
        throw new Error("Could not refresh the local Codex sign-in. Sign in again in Nyte.");
      });
    const credential = await credentials.read("openai-codex");
    if (!auth?.auth.apiKey || credential?.type !== "oauth")
      throw new Error("Sign in to OpenAI Codex in the local Nyte desktop before syncing.");

    console.log(`Updating nyte-server Production for openai-codex/${values.model}.`);
    await setProductionVariable(root, "OPENAI_CODEX_ACCESS_TOKEN", auth.auth.apiKey, true);
    await setProductionVariable(root, "NYTE_MODEL", `openai-codex/${values.model}`, false);
    console.log(
      `Codex access token synced. Expires ${new Date(credential.expires).toISOString()}.`,
    );
    console.log("Run pnpm run deploy to apply the updated environment.");
  } catch (error) {
    console.error(`Codex sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  }
}

async function setProductionVariable(root: URL, name: string, value: string, sensitive: boolean) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vercel",
        "env",
        "add",
        name,
        "production",
        "--force",
        "--yes",
        sensitive ? "--sensitive" : "--no-sensitive",
      ],
      { cwd: root, stdio: ["pipe", "ignore", "pipe"], timeout: 30_000 },
    );
    // Do not forward CLI output: authentication errors may contain submitted secret values.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => reject(new Error(`Could not start Vercel CLI for ${name}.`)));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Vercel could not update ${name}. Check the project link and Vercel login.`),
          ),
    );
    child.stdin.end(value);
  });
}
