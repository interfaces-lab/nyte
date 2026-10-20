import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryStore } from "@nyte-ai/core/store";
import type { Host } from "@nyte-ai/core";
import type { SessionId } from "@nyte-ai/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openHost } from "@nyte-ai/host";
import { CASSETTES, playCassette } from "../src/cassettes.ts";
import type { BenchCassette } from "../src/cassettes.ts";
import { fakeModels, open } from "../src/fake-models.ts";
import { openRecorder } from "../src/recorder.ts";
import type { RecorderSocket, RecorderSocketClass, SocketEvent } from "../src/recorder.ts";

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-recorded-")));
  folders.push(made);

  return made;
}

async function answerText(host: Pick<Host, "session">, session: SessionId): Promise<string> {
  const view = await host.session(session).view();

  return JSON.stringify(view.messages.at(-1));
}

async function chatOnly(cassette: BenchCassette, replayKey?: string) {
  const player = await playCassette({ cassette, replayKey });

  if (cassette === CASSETTES.codexWebSocket) vi.stubGlobal("WebSocket", player.WebSocket);
  const host = await open({ ...fakeModels(), models: player.models });
  const { session, receipt } = await host.sessions.start({ content: cassette.prompt });
  await receipt.settled();
  const answer = await answerText(host, session.id);
  await host.close();
  await player.close();

  return answer;
}

describe("replayed provider traffic", () => {
  it("runs a tool call off an Anthropic Messages stream: reads the file, answers, and the chat's title lands in the list", async () => {
    const root = await folder();
    const workspace = join(root, "workspace");
    const home = join(root, "home");
    await mkdir(workspace);
    await mkdir(home);
    await writeFile(join(workspace, "notes.txt"), "buy oat milk\ncall the landlord\n");
    const cassette = CASSETTES.anthropicToolUse;
    await using player = await playCassette({ cassette, paths: { workspace } });

    await using host = await openHost({
      store: memoryStore(),
      models: player.models,
      workspace: { kind: "local", path: workspace },
      home,
    });

    const { session, receipt } = await host.sessions.start({ content: cassette.prompt });
    await receipt.settled();

    await expect
      .poll(async () => (await host.sessions.list({ parents: { kind: "roots" } })).items[0]?.name)
      .toBe("Reading my notes");

    const view = await host.session(session.id).view();

    expect(view.messages.map((message) => message.kind)).toEqual(["user", "part", "part", "part"]);
    expect(JSON.stringify(view.messages)).toContain('"path":"notes.txt"');
    expect(await answerText(host, session.id)).toContain(cassette.answer);
  });

  it.each([
    ["OpenAI Responses", CASSETTES.openaiResponses],
    ["OpenRouter Chat Completions", CASSETTES.openrouterCompletions],
  ])("answers a chat streamed over %s", async (_name, cassette) => {
    expect(await chatOnly(cassette)).toContain(cassette.answer);
  });

  it("answers a chat off Codex's WebSocket transport", async () => {
    const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "acc_replay" } };
    const token = `replay.${Buffer.from(JSON.stringify(claims)).toString("base64")}.replay`;

    expect(await chatOnly(CASSETTES.codexWebSocket, token)).toContain(
      CASSETTES.codexWebSocket.answer,
    );
  });
});

describe("the recorder", () => {
  it("answers a request no exchange matches with a 400 naming the differing fields, and close() throws it", async () => {
    const cassette = CASSETTES.openaiResponses;
    const player = await playCassette({ cassette });
    const host = await open({ ...fakeModels(), models: player.models });
    const { receipt } = await host.sessions.start({ content: "Name an even number." });
    await receipt.settled();
    await host.close();
    await expect(player.close()).rejects.toThrow(
      /body\.input\.1\.content\.0\.text: expected "Name a prime number\.", received "Name an even number\."[\s\S]*was never requested/u,
    );
  });

  it("records with credentials, user paths and per-session keys out of the file, and puts the paths back on replay", async () => {
    const root = await folder();
    const path = join(root, "cassette.json");
    const workspace = join(root, "workspace");
    vi.stubEnv("NYTE_RECORD", "1");
    vi.stubEnv("CI", "");

    const recorder = await openRecorder({
      path,
      paths: { workspace },
      volatile: ["session"],
      upstream: {
        fetch: async () =>
          new Response(`data: {"file":"${workspace}/a.txt"}\n\n`, {
            headers: { "content-type": "text/event-stream", "set-cookie": "id=1" },
          }),
      },
    });

    const recorded = await recorder.fetch("https://api.example.test/v1/chat?key=abc", {
      method: "POST",
      headers: {
        authorization: "Bearer real",
        "content-type": "application/json",
        "user-agent": "x",
      },
      body: JSON.stringify({ session: "s-1", cwd: workspace, api_key: "real" }),
    });

    expect(await recorded.text()).toContain(`${workspace}/a.txt`);
    await recorder.close();
    const written = await readFile(path, "utf8");

    expect(written).not.toContain(root);
    expect(JSON.parse(written).exchanges[0]).toMatchObject({
      request: {
        url: "https://api.example.test/v1/chat?key=%5BREDACTED%5D",
        headers: { authorization: "[REDACTED]", "content-type": "application/json" },
        body: { api_key: "[REDACTED]", cwd: "<workspace>", session: "<volatile>" },
      },
      response: {
        headers: { "content-type": "text/event-stream" },
        chunks: ['data: {"file":"<workspace>/a.txt"}\n\n'],
      },
    });

    vi.stubEnv("NYTE_RECORD", "");
    const moved = join(root, "elsewhere");

    await using replayed = await openRecorder({
      path,
      paths: { workspace: moved },
      volatile: ["session"],
    });

    const response = await replayed.fetch("https://api.example.test/v1/chat?key=other", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer other" },
      body: JSON.stringify({ cwd: moved, api_key: "other", session: "s-2" }),
    });

    expect(await response.text()).toBe(`data: {"file":"${moved}/a.txt"}\n\n`);
  });

  it("records a socket's frames in order with its credentials out, and replays them to a client that sends the same frames", async () => {
    const root = await folder();
    const path = join(root, "socket.json");
    vi.stubEnv("NYTE_RECORD", "1");
    vi.stubEnv("CI", "");

    class Echo implements RecorderSocket {
      readyState = 1;
      readonly #listeners = new Set<(event: SocketEvent) => void>();

      send(data: string): void {
        setTimeout(() => {
          for (const listener of this.#listeners) listener({ data: `echo ${data}` });
        }, 0);
      }

      close(): void {
        this.readyState = 3;
      }

      addEventListener(type: string, listener: (event: SocketEvent) => void): void {
        if (type === "message") this.#listeners.add(listener);
      }

      removeEventListener(_type: string, listener: (event: SocketEvent) => void): void {
        this.#listeners.delete(listener);
      }
    }

    const converse = (Socket: RecorderSocketClass) =>
      new Promise<unknown>((resolve) => {
        const socket = new Socket("wss://api.example.test/socket", {
          headers: { authorization: "Bearer real", "openai-beta": "sockets" },
        });

        socket.addEventListener("message", (event) => resolve(event.data));
        socket.send(JSON.stringify({ say: "hi", token: "real" }));
      });

    const recorder = await openRecorder({ path, upstream: { WebSocket: Echo } });

    expect(await converse(recorder.WebSocket)).toBe('echo {"say":"hi","token":"real"}');
    await recorder.close();
    expect(JSON.parse(await readFile(path, "utf8")).exchanges).toEqual([
      {
        transport: "websocket",
        url: "wss://api.example.test/socket",
        headers: { authorization: "[REDACTED]", "openai-beta": "sockets" },
        frames: [
          { from: "client", data: '{"say":"hi","token":"[REDACTED]"}' },
          { from: "server", data: 'echo {"say":"hi","token":"real"}' },
        ],
      },
    ]);

    vi.stubEnv("NYTE_RECORD", "");
    await using replayed = await openRecorder({ path });

    expect(await converse(replayed.WebSocket)).toBe('echo {"say":"hi","token":"real"}');
  });

  it("refuses to write a cassette that still holds a secret, and to record in CI", async () => {
    const root = await folder();
    vi.stubEnv("NYTE_RECORD", "1");
    vi.stubEnv("CI", "");

    const recorder = await openRecorder({
      path: join(root, "leak.json"),
      upstream: { fetch: async () => new Response("sk-ant-api03-abcdefghijklmnopqrstuvwxyz") },
    });

    await (await recorder.fetch("https://api.example.test/", { method: "GET" })).text();
    await expect(recorder.close()).rejects.toThrow(/Anthropic or OpenAI key/u);

    vi.stubEnv("CI", "true");
    await expect(openRecorder({ path: join(root, "ci.json") })).rejects.toThrow(/in CI/u);
  });
});
