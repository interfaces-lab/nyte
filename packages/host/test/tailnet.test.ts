import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { memoryStore } from "@nyte-ai/core/store";
import type { Host } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { openHost } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const TOKEN = "a-token-of-16-chars";

const SIDECAR = `
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const log = (entry) => appendFileSync(join(value("--dir"), "runs.jsonl"), JSON.stringify(entry) + "\\n");

if (args.includes("--logout")) {
  log({ logout: true });
  process.exit(0);
}

log({ pid: process.pid, args, key: args.includes("--auth-key-fd") ? readFileSync(0, "utf8") : null });

const access = value("--access");
const tags = args.flatMap((arg, index) => (args[index - 1] === "--tag" ? [arg] : []));
const say = (status) => process.stdout.write(JSON.stringify({ access, tags, ...status }) + "\\n");

say({ state: "starting", https: "pending" });
say({ state: "running", dnsName: value("--hostname") + ".example.ts.net", https: "available" });
process.on("SIGTERM", () => {
  say({ state: "stopped", https: "pending" });
  process.exit(0);
});
setInterval(() => undefined, 1000);
`;

type Run = {
  readonly pid?: number;
  readonly args?: readonly string[];
  readonly key?: string | null;
  readonly logout?: true;
};

type Answer = { readonly status: number; readonly body: unknown };

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(): Promise<{ readonly home: string; readonly binary: string }> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-tailnet-")));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const binary = join(home, "nyte-tailnet");
  await writeFile(binary, `#!${process.execPath}\n${SIDECAR}`);
  await chmod(binary, 0o755);

  return { home, binary };
}

async function open(home: string, binary: string): Promise<Host> {
  const host = await openHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home,
    tailnet: { binary },
  });

  cleanups.push(() => host.close());

  return host;
}

async function localSocket(host: Host, home: string): Promise<string> {
  const path = join(home, "host.sock");
  await host.listen({ transport: { kind: "socket", path }, auth: { kind: "token", token: TOKEN } });

  return path;
}

function post(
  socketPath: string,
  name: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = { Authorization: `Bearer ${TOKEN}` },
): Promise<Answer> {
  return new Promise<Answer>((answered, failed) => {
    const sent = request(
      {
        socketPath,
        path: `/${name}`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Host: "nyte.example.ts.net" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          const text = Buffer.concat(chunks).toString("utf8");
          const frame = /^data: (.*)$/m.exec(text)?.[1];

          if (frame === undefined) return;
          answered({ status: response.statusCode ?? 0, body: JSON.parse(frame) });
          response.destroy();
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          answered({
            status: response.statusCode ?? 0,
            body: text === "" ? null : JSON.parse(text),
          });
        });
      },
    );

    sent.on("error", failed);
    sent.end(JSON.stringify(body));
  });
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (;;) {
    const value = await read();

    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function runs(home: string): Promise<readonly Run[]> {
  const text = await readFile(join(home, ".nyte", "tailnet", "runs.jsonl"), "utf8").catch(() => "");

  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line): Run => JSON.parse(line));
}

function principalHeader(userId: string, owner: boolean) {
  const principal = {
    kind: "tailscale",
    userId,
    loginName: "ada@example.com",
    node: "n1",
    tags: [],
    owner,
  };

  return {
    "X-Nyte-Tailnet-Principal": Buffer.from(JSON.stringify(principal)).toString("base64url"),
  };
}

const status = (socket: string) => post(socket, "host.tailnet.status", {});

const stateIs = (state: string) => (answer: Answer) =>
  typeof answer.body === "object" &&
  answer.body !== null &&
  "state" in answer.body &&
  answer.body.state === state;

describe.skipIf(process.platform === "win32")("the embedded tailnet node", () => {
  it("saves its settings without the auth key, hands the key over stdin once, and starts again from the saved settings", async () => {
    const { home, binary } = await setup();
    const first = await open(home, binary);
    const socket = await localSocket(first, home);

    expect((await status(socket)).body).toEqual({
      state: "disabled",
      https: "unavailable",
      access: "owner",
      tags: [],
    });

    const configured = await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "studio",
      tags: ["tag:ci"],
      access: "tailnet",
      authKey: "tskey-secret",
    });

    expect(configured.status).toBe(200);
    expect((await until(() => status(socket), stateIs("running"))).body).toEqual({
      state: "running",
      dnsName: "studio.example.ts.net",
      https: "available",
      access: "tailnet",
      tags: ["tag:ci"],
    });

    const saved = await readFile(join(home, ".nyte", "tailnet.json"), "utf8");

    expect(JSON.parse(saved)).toEqual({
      enabled: true,
      hostname: "studio",
      tags: ["tag:ci"],
      access: "tailnet",
    });
    expect(saved).not.toContain("tskey");
    expect((await runs(home))[0]).toMatchObject({ key: "tskey-secret" });
    expect((await runs(home))[0]?.args).toEqual(expect.arrayContaining(["--auth-key-fd", "0"]));
    expect((await runs(home))[0]?.args?.join(" ")).not.toContain("tskey");

    await first.close();
    const second = await open(home, binary);

    for await (const view of second.watch()) if (view.tailnet?.state === "running") break;

    expect((await runs(home))[1]).toMatchObject({ key: null });

    const again = await localSocket(second, home);
    const signedOut = await post(again, "host.tailnet.logout", {});

    expect(signedOut.body).toEqual({
      state: "disabled",
      https: "unavailable",
      access: "tailnet",
      tags: ["tag:ci"],
    });
    expect((await runs(home)).at(-1)).toEqual({ logout: true });
    expect(JSON.parse(await readFile(join(home, ".nyte", "tailnet.json"), "utf8"))).toMatchObject({
      enabled: false,
    });
  });

  it("answers local operations only on the local socket and admits the sidecar's callers as their tailscale principal", async () => {
    const { home, binary } = await setup();
    const host = await open(home, binary);
    const socket = await localSocket(host, home);

    const network = await host.listen({
      transport: { kind: "http" },
      auth: { kind: "token", token: TOKEN },
    });

    const overNetwork = await fetch(`${network.address}/host.tailnet.status`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    });

    expect(overNetwork.status).toBe(403);
    expect(await overNetwork.json()).toMatchObject({ code: "denied" });

    await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "nyte",
      tags: [],
      access: "owner",
    });
    await until(() => status(socket), stateIs("running"));

    const tailnet = join(home, ".nyte", "tailnet.sock");

    const owner = principalHeader("7", true);

    const overTailnet = await post(tailnet, "host.tailnet.status", {}, owner);

    expect(overTailnet.status).toBe(403);

    const view = await post(
      tailnet,
      "connection.watch",
      {},
      {
        ...owner,
        Authorization: `Bearer ${TOKEN}`,
      },
    );

    expect(view.body).toMatchObject({
      principal: "tailscale:user:7",
      authority: ["participant", "owner"],
      tailnet: { state: "running", access: "owner" },
    });

    const member = await post(tailnet, "connection.watch", {}, principalHeader("8", false));

    expect(member.body).toMatchObject({
      principal: "tailscale:user:8",
      authority: ["participant"],
    });
    expect((await post(tailnet, "models.list", {}, {})).status).toBe(401);
  });

  it("reads stopped while it restarts a node that exited on its own", async () => {
    const { home, binary } = await setup();
    const host = await open(home, binary);
    const socket = await localSocket(host, home);

    await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "nyte",
      tags: [],
      access: "owner",
    });
    await until(() => status(socket), stateIs("running"));
    const crashed = (await runs(home))[0]?.pid;

    expect(crashed).toBeTypeOf("number");
    process.kill(crashed ?? 0, "SIGKILL");

    expect((await until(() => status(socket), stateIs("stopped"))).body).toMatchObject({
      state: "stopped",
      https: "unavailable",
    });
    await until(() => status(socket), stateIs("running"));

    const restarted = await runs(home);

    expect(restarted).toHaveLength(2);
    expect(restarted[1]?.pid).not.toBe(crashed);
  });
});
