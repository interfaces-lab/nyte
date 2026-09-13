import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, test, vi } from "vitest";
import { discoverMentionFiles } from "../src/mention-files.ts";

let root: string;
let executable: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "nyte-mention-process-"));
  executable = join(root, "rg");
  vi.stubEnv("PATH", root);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function program(body: string) {
  await writeFile(
    executable,
    `#!${process.execPath}\nif (process.argv.includes("--version")) { console.log("ripgrep 15.1.0"); process.exit(0); }\n${body}`,
  );
  await chmod(executable, 0o755);
}

test.skipIf(process.platform === "win32")(
  "cancels a running mention process and waits for its death",
  async () => {
    const controller = new AbortController();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const started = new Promise<number>((resolve) =>
      server.once("connection", (socket) => {
        socket.once("data", (data) => {
          resolve(Number(data.toString()));
          socket.destroy();
        });
      }),
    );
    await program(
      `const net = require("node:net");\nconst socket = net.connect(${address.port}, "127.0.0.1", () => socket.write(String(process.pid)));\nsetInterval(() => {}, 1000);`,
    );
    const pending = discoverMentionFiles(root, controller.signal);
    const rejected = assert.rejects(pending, /abort/iu);
    try {
      const pid = await started;
      controller.abort();
      await rejected;
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      await rejected;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test.skipIf(process.platform === "win32")(
  "propagates process failures instead of claiming the workspace is empty",
  async () => {
    await program('process.stderr.write("mention discovery failed"); process.exitCode = 42;');
    await assert.rejects(discoverMentionFiles(root), /42.*mention discovery failed/su);
  },
);

test("rejects pre-cancelled discovery", async () => {
  await assert.rejects(discoverMentionFiles(root, AbortSignal.abort()), /abort/iu);
});
