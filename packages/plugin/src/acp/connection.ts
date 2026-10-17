import { randomUUID } from "node:crypto";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";
import type { ClientConnection, InitializeResponse } from "@agentclientprotocol/sdk";
import { processEnvironment } from "@nyte-ai/core";
import type { ExecutionEnv, Job } from "@nyte-ai/core";
import manifest from "../../package.json" with { type: "json" };
import type { AcpAgent } from "./registry.ts";
import { AcpThread } from "./thread.ts";

const AUTH_REQUIRED = -32_000;

const STDERR_TAIL = 4_096;

/** The agent's stdout as a byte stream of its JSON-RPC lines; any other line, such as stderr the pipe interleaves, goes to `other`. */
function messageLines(job: Job, other: (line: string) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (line: string) => {
        if (line.trimStart().startsWith("{")) controller.enqueue(encoder.encode(`${line}\n`));
        else if (line.trim() !== "") other(line);
      };

      for await (const frame of job.output()) {
        if (frame.kind !== "bytes") continue;
        const lines = (pending + decoder.decode(frame.data, { stream: true })).split("\n");
        pending = lines.pop() ?? "";

        for (const line of lines) emit(line);
      }

      emit(pending + decoder.decode());
      controller.close();
    },
  });
}

/**
 * One agent process, started in a session's environment so the host's
 * environment, sandbox and login-shell gate apply to it, and the ACP
 * connection over its stdio. Each `open` starts an ACP session on it.
 */
export class AcpProcess {
  readonly agent: AcpAgent;
  readonly #job: Job;
  readonly #connection: ClientConnection;
  readonly #threads = new Map<string, AcpThread>();
  readonly #ready: Promise<InitializeResponse>;
  #stderr = "";
  #failure: Error | undefined;

  private constructor(agent: AcpAgent, job: Job) {
    this.agent = agent;
    this.#job = job;

    const app = client({ name: "nyte" })
      .onNotification(methods.client.session.update, (context) =>
        this.#threads.get(context.params.sessionId)?.update(context.params.update),
      )
      .onRequest(
        methods.client.session.requestPermission,
        async (context) =>
          (await this.#threads.get(context.params.sessionId)?.permission(context.params)) ?? {
            outcome: { outcome: "cancelled" },
          },
      );

    const writable = new WritableStream<Uint8Array>({ write: (chunk) => job.write(chunk) });

    const readable = messageLines(job, (line) => {
      this.#stderr = `${this.#stderr}${line}\n`.slice(-STDERR_TAIL);
    });

    this.#connection = app.connect(ndJsonStream(writable, readable));

    void this.#connection.closed.then(() =>
      this.close(new Error(`${agent.name} exited.${this.#detail()}`)),
    );

    this.#ready = this.#connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "nyte", title: "Nyte", version: manifest.version },
    });

    this.#ready.catch(() => undefined);
  }

  /** Starts `agent` through `env.exec`, after the process environment is whole. */
  static async start(env: ExecutionEnv, agent: AcpAgent): Promise<AcpProcess> {
    await processEnvironment();
    const job = await env.exec([agent.command, ...agent.args], { env: { ...agent.env } });

    return new AcpProcess(agent, job);
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  /** Whether the agent reads image blocks in a prompt. */
  async images(): Promise<boolean> {
    return (await this.#initialized()).agentCapabilities?.promptCapabilities?.image === true;
  }

  /** Starts an ACP session in `cwd`; an agent that wants a sign-in first fails with how to give it one. */
  async open(cwd: string): Promise<AcpThread> {
    await this.#initialized();

    let sessionId: string;

    try {
      ({ sessionId } = await this.#connection.agent.request(methods.agent.session.new, {
        cwd,
        mcpServers: [],
      }));
    } catch (error) {
      if (error instanceof RequestError && error.code === AUTH_REQUIRED)
        throw new Error(`Sign in to ${this.agent.name} in a terminal, then send again.`, {
          cause: error,
        });
      throw error;
    }

    const thread = new AcpThread(`acp-${randomUUID().slice(0, 8)}-`, {
      prompt: (blocks) =>
        this.#connection.agent.request(methods.agent.session.prompt, {
          sessionId,
          prompt: [...blocks],
        }),
      cancel: () =>
        void this.#connection.agent
          .notify(methods.agent.session.cancel, { sessionId })
          .catch(() => undefined),
    });

    this.#threads.set(sessionId, thread);

    return thread;
  }

  /** Drops a thread Nyte no longer follows, cancelling its turn. */
  forget(thread: AcpThread): void {
    for (const [id, known] of this.#threads)
      if (known === thread) {
        this.#threads.delete(id);
        thread.close();
      }
  }

  close(reason: Error = new Error(`${this.agent.name} closed.`)): void {
    if (this.#failure !== undefined) return;
    this.#failure = reason;

    for (const thread of this.#threads.values()) thread.close(reason);
    this.#threads.clear();
    this.#connection.close();
    void this.#job.stop().catch(() => undefined);
  }

  async #initialized(): Promise<InitializeResponse> {
    if (this.#failure !== undefined) throw this.#failure;

    try {
      return await this.#ready;
    } catch (error) {
      throw this.#failure ?? error;
    }
  }

  #detail(): string {
    const tail = this.#stderr.trim().slice(-500);

    return tail === "" ? "" : ` (${tail})`;
  }
}
