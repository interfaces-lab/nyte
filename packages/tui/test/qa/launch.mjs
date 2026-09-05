import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Set the child's home before Bun or any module caches os.homedir().
const directory = await mkdtemp(join(tmpdir(), "nyte-tui-qa-"));
const home = join(directory, "home");
await mkdir(home);
try {
  const child = spawn(
    "bun",
    [
      "--no-env-file",
      fileURLToPath(new URL("./main.ts", import.meta.url)),
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        OPENCODE_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_OAUTH_TOKEN: "",
        HOME: home,
        USERPROFILE: home,
        NYTE_HOME: join(home, ".nyte"),
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        NYTE_SKIP_VERSION_CHECK: "1",
        NYTE_QA_ROOT: directory,
      },
    },
  );
  const interrupt = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
