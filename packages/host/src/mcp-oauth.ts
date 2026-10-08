import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import type { McpOAuth, McpOAuthState } from "@nyte-ai/plugin/mcp";
import { Type, Unsafe } from "typebox";
import { Value } from "typebox/value";
import { isFileError, nyteHome } from "./paths.ts";

const StateFile = Type.Record(
  Type.String(),
  Unsafe<McpOAuthState>(Type.Object({ serverUrl: Type.String() })),
);

/** OAuth state for remote MCP servers, keyed by server URL, in `~/.nyte/mcp-auth.json`. */
export function hostMcpOAuth(path = join(nyteHome(), "mcp-auth.json")): McpOAuth {
  let writes = Promise.resolve();

  const load = async (): Promise<Record<string, McpOAuthState>> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      return Value.Check(StateFile, parsed) ? parsed : {};
    } catch (error) {
      if (isFileError(error, ["ENOENT"])) return {};
      throw error;
    }
  };

  return {
    store: (serverUrl) => ({
      load: async () => (await load())[serverUrl],
      save: (state) => {
        writes = writes.then(async () => {
          const next = { ...(await load()), [serverUrl]: state };
          const staging = `${path}.${process.pid}.tmp`;
          await mkdir(dirname(path), { recursive: true });
          await writeFile(staging, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
          await rename(staging, path);
        });
        return writes;
      },
    }),
    open: (url) => {
      const [command, ...args] =
        process.platform === "darwin"
          ? ["open"]
          : process.platform === "win32"
            ? ["cmd", "/c", "start", ""]
            : ["xdg-open"];
      spawn(command, [...args, url.href], { detached: true, stdio: "ignore" })
        .on("error", () => undefined)
        .unref();
    },
  };
}
