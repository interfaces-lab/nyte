import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { dev } from "@nyte-ai/core";
import { compile } from "@nyte-ai/schema";
import { openHost } from "../src/index.ts";

const PROMPT = "Use the nyte MCP tools to list the host's sessions and say how many there are.";

const REDIRECT = "http://127.0.0.1:1/callback";

const AGENT_MS = 5 * 60 * 1000;

const root = await mkdtemp(join(tmpdir(), "nyte-mcp-agents-"));
const home = join(root, "home");
const project = join(root, "project");
const socket = join(home, ".nyte", "host.sock");
const token = randomBytes(32).toString("base64url");
const hostLog: string[] = [];
const agentEnv = { ...process.env };
await mkdir(project, { recursive: true });
process.env.HOME = home;
dev.on((line) => hostLog.push(line));

const host = await openHost({ home, workspace: { kind: "local", path: project } });

try {
  const auth = { kind: "token", token } as const;
  const listener = await host.listen({
    transport: { kind: "http", hostname: "127.0.0.1", port: 0 },
    auth,
  });

  await host.listen({
    transport: { kind: "socket", path: socket },
    auth,
    execution: { kind: "admit-only" },
  });

  if (listener.address === null) throw new Error("The host bound no address.");
  const url = listener.address;
  const resource = `${url}/mcp`;
  process.stdout.write(`host: ${url}, local socket ${socket}\n`);

  const catalog = await json(
    await post(`${url}/models.list`, token, {}),
    Type.Object({
      providers: Type.Array(
        Type.Object({
          models: Type.Array(
            Type.Object({ ref: Type.Object({ provider: Type.String(), id: Type.String() }) }),
          ),
        }),
      ),
    }),
  );
  const model = catalog.providers.flatMap((entry) => entry.models)[0];

  if (model === undefined) throw new Error("The host lists no model.");

  const started = await json(
    await post(`${url}/sessions.start`, token, {
      id: randomUUID(),
      name: "MCP agents check",
      configuration: { model: model.ref },
      content: "Say hello.",
    }),
    Type.Object({ session: Type.String() }),
  );
  process.stdout.write(`created a session: ${JSON.stringify(started)}\n`);

  const access = await signIn(url, resource, socket, token);
  process.stdout.write("signed in with a read-only grant\n");

  const claude = await runClaude(resource, access);
  const codex = await runCodex(resource, access);

  process.stdout.write(`\nClaude Code (exit ${claude.code}):\n${claude.output.trim()}\n`);
  process.stdout.write(`\nCodex (exit ${codex.code}):\n${codex.output.trim()}\n`);
  process.stdout.write(
    `\nTool calls the host logged:\n${hostLog.filter((line) => line.startsWith("DEV:mcp tool")).join("\n")}\n`,
  );
  process.exitCode = claude.code === 0 && codex.code === 0 ? 0 : 1;
} finally {
  await host.close();
  await rm(root, { recursive: true, force: true });
}

async function signIn(
  url: string,
  resource: string,
  socket: string,
  token: string,
): Promise<string> {
  const registered = await json(
    await fetch(`${url}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP agents check",
        application_type: "native",
        redirect_uris: [REDIRECT],
      }),
    }),
    Type.Object({ client_id: Type.String() }),
  );

  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
    state: randomBytes(8).toString("hex"),
  });

  const page = await (await fetch(`${url}/oauth/authorize?${params.toString()}`)).text();
  const pending = /data-request="([^"]+)"/.exec(page)?.[1];
  const code = /<code id="code">([^<]+)<\/code>/.exec(page)?.[1];

  if (pending === undefined || code === undefined)
    throw new Error(`The authorize page shows no code:\n${page}`);
  process.stdout.write(`authorize page code: ${code}\n`);

  const approved = await socketCall(socket, token, "mcp.approve", {
    code,
    access: { kind: "read-only" },
  });
  process.stdout.write(`mcp.approve over the local socket: ${approved}\n`);

  const state = await json(
    await fetch(`${url}/oauth/authorize/state?request=${pending}`),
    Type.Object({ location: Type.String() }),
  );
  const authorization = new URL(state.location).searchParams.get("code");

  if (authorization === null)
    throw new Error(`The sign-in ended without a code: ${state.location}`);

  const tokens = await json(
    await fetch(`${url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorization,
        redirect_uri: REDIRECT,
        client_id: registered.client_id,
        code_verifier: verifier,
        resource,
      }).toString(),
    }),
    Type.Object({ access_token: Type.String() }),
  );

  return tokens.access_token;
}

async function runClaude(
  resource: string,
  access: string,
): Promise<{ readonly code: number; readonly output: string }> {
  const config = join(root, "claude");
  const env = { ...agentEnv, CLAUDE_CONFIG_DIR: config };
  await mkdir(config, { recursive: true });

  await run(
    "claude",
    [
      "mcp",
      "add",
      "--transport",
      "http",
      "nyte",
      resource,
      "--header",
      `Authorization: Bearer ${access}`,
    ],
    env,
  );
  const listed = await run("claude", ["mcp", "list"], env);
  process.stdout.write(`claude mcp list:\n${listed.output.trim()}\n`);

  return run("claude", ["-p", PROMPT, "--allowedTools", "mcp__nyte__*"], env);
}

async function runCodex(
  resource: string,
  access: string,
): Promise<{ readonly code: number; readonly output: string }> {
  const codexHome = join(root, "codex");
  const env = { ...agentEnv, CODEX_HOME: codexHome, NYTE_MCP_TOKEN: access };
  await mkdir(codexHome, { recursive: true });
  const auth = agentEnv.NYTE_AGENTS_CODEX_AUTH;

  if (auth !== undefined) await copyFile(auth, join(codexHome, "auth.json"));

  await run(
    "codex",
    ["mcp", "add", "nyte", "--url", resource, "--bearer-token-env-var", "NYTE_MCP_TOKEN"],
    env,
  );
  const listed = await run("codex", ["mcp", "list"], env);
  process.stdout.write(`codex mcp list:\n${listed.output.trim()}\n`);

  return run(
    "codex",
    ["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", PROMPT],
    env,
  );
}

function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((done, failed) => {
    const child = spawn(command, args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), AGENT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", failed);
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

function post(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function socketCall(socket: string, token: string, name: string, body: unknown): Promise<string> {
  const payload = JSON.stringify(body);

  return new Promise((done, failed) => {
    const sent = request(
      {
        socketPath: socket,
        path: `/${name}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");

          if (response.statusCode === 200) done(text);
          else failed(new Error(`${name} answered ${String(response.statusCode)}: ${text}`));
        });
      },
    );
    sent.once("error", failed);
    sent.end(payload);
  });
}

async function json<T extends TSchema>(response: Response, type: T): Promise<Static<T>> {
  const value: unknown = await response.json();

  if (!compile(type).Check(value))
    throw new Error(`Unexpected answer ${response.status}: ${JSON.stringify(value)}`);

  return value;
}
