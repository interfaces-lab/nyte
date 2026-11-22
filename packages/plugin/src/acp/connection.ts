import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk/unstable";
import type {
  ClientConnection,
  CreateElicitationResponse,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk/unstable";
import { processEnvironment } from "@nyte-ai/core";
import type { ExecutionEnv, Job } from "@nyte-ai/core";
import manifest from "../../package.json" with { type: "json" };
import type { AcpAgent } from "./catalog.ts";
import { Value } from "typebox/value";
import { createDialect } from "./dialects.ts";
import { formRequest } from "./forms.ts";
import type { Dialect } from "./dialects.ts";
import { AcpThread } from "./thread.ts";
import type { AcpApprove } from "./thread.ts";

const AUTH_REQUIRED = -32_000;

const STDERR_TAIL = 4_096;

const STOP_GRACE_MS = 1_000;

interface Pipe {
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
  stop(): Promise<unknown>;
}

function protocolStream(job: Job, stderr: (bytes: Uint8Array) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const frame of job.output()) {
        if (frame.kind === "gap") {
          controller.error(
            new Error("The agent's output lost bytes, so its protocol stream broke."),
          );

          return;
        }

        if (frame.kind !== "bytes") continue;

        if (frame.stream === "stderr") stderr(frame.data);
        else controller.enqueue(frame.data);
      }

      controller.close();
    },
  });
}

export interface AgentChoice {
  readonly model: string | undefined;
  readonly thought: string | undefined;
}

export function choices(
  option: SessionConfigOption | undefined,
): readonly SessionConfigSelectOption[] {
  if (option?.type !== "select") return [];

  return option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]));
}

export function findOption(
  options: readonly SessionConfigOption[],
  category: "model" | "thought_level",
): SessionConfigOption | undefined {
  return options.find((option) => option.category === category && option.type === "select");
}

export class AcpProcess {
  readonly agent: AcpAgent;
  readonly #pipe: Pipe;
  readonly #connection: ClientConnection;
  readonly #dialect: Dialect;
  readonly #threads = new Map<string, AcpThread>();
  readonly #parentSessions = new Map<string, string>();
  readonly #options = new Map<string, readonly SessionConfigOption[]>();
  readonly #ready: Promise<InitializeResponse>;
  #stderr = "";
  #failure: Error | undefined;

  private constructor(agent: AcpAgent, connect: (stderr: (bytes: Uint8Array) => void) => Pipe) {
    this.agent = agent;
    this.#dialect = createDialect(agent.dialect);

    const sessionClient = client({ name: "nyte" })
      .onNotification(methods.client.session.update, (context) =>
        this.#takeUpdate(context.params.sessionId, context.params.update),
      )
      .onRequest(methods.client.session.requestPermission, (context) =>
        this.#askPermission(context.params),
      )
      .onRequest(methods.client.elicitation.create, (context) => this.#askForm(context.params));

    const app = [...this.#dialect.notifications].reduce(
      (built, [method, readReport]) =>
        built.onNotification(
          method,
          (params: unknown) => params,
          (context) => {
            const report = readReport(context.params);

            if (report !== undefined) this.#threads.get(report.sessionId)?.reportSubagent(report);
          },
        ),
      sessionClient,
    );

    const decoder = new TextDecoder();

    this.#pipe = connect((bytes) => {
      this.#stderr = (this.#stderr + decoder.decode(bytes, { stream: true })).slice(-STDERR_TAIL);
    });

    this.#connection = app.connect(ndJsonStream(this.#pipe.input, this.#pipe.output));

    void this.#connection.closed.then(() =>
      this.close(new Error(`${agent.name} exited.${this.#detail()}`)),
    );

    this.#ready = this.#connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        subagents: {},
        elicitation: { form: {} },
        ...(this.#dialect.capabilityMeta === undefined
          ? {}
          : { _meta: this.#dialect.capabilityMeta }),
      },
      clientInfo: { name: "nyte", title: "Nyte", version: manifest.version },
    });

    this.#ready.catch((error: unknown) =>
      this.close(error instanceof Error ? error : new Error(String(error))),
    );
  }

  static async start(env: ExecutionEnv, agent: AcpAgent): Promise<AcpProcess> {
    await processEnvironment();
    const job = await env.exec([agent.command, ...agent.args], {
      env: { ...agent.env },
      stdio: "protocol",
    });

    return new AcpProcess(agent, (stderr) => ({
      input: new WritableStream<Uint8Array>({ write: (chunk) => job.write(chunk) }),
      output: protocolStream(job, stderr),
      stop: () => job.stop(),
    }));
  }

  /** Runs the agent on this machine, outside any session's environment, as a catalog probe does. */
  static spawn(agent: AcpAgent, cwd: string): AcpProcess {
    const child = spawn(agent.command, [...agent.args], {
      cwd,
      env: { ...process.env, ...agent.env },
      stdio: "pipe",
    });

    return new AcpProcess(agent, (stderr) => {
      child.stderr.on("data", (chunk: Buffer) => stderr(chunk));

      let open = true;

      const end = (finish: () => void) => {
        if (!open) return;
        open = false;
        finish();
      };

      return {
        input: new WritableStream<Uint8Array>({
          write: (chunk) =>
            new Promise<void>((resolve, reject) =>
              child.stdin.write(chunk, (error) => (error ? reject(error) : resolve())),
            ),
        }),
        output: new ReadableStream<Uint8Array>({
          start(controller) {
            child.stdout.on("data", (chunk: Buffer) => {
              if (open) controller.enqueue(chunk);
            });
            child.on("error", (error) => end(() => controller.error(error)));
            child.stdin.on("error", (error) => end(() => controller.error(error)));
            child.on("close", () => end(() => controller.close()));
          },
          cancel: () => end(() => undefined),
        }),
        stop: () =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();

              return;
            }

            const force = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
            child.once("exit", () => {
              clearTimeout(force);
              resolve();
            });
            child.kill();
          }),
      };
    });
  }

  get closed(): boolean {
    return this.#failure !== undefined;
  }

  async images(): Promise<boolean> {
    return (await this.#initialized()).agentCapabilities?.promptCapabilities?.image === true;
  }

  async open(cwd: string, approve: AcpApprove): Promise<AcpThread> {
    await this.#initialized();

    let session: Awaited<ReturnType<typeof this.newSession>>;

    try {
      session = await this.newSession(cwd);
    } catch (error) {
      if (error instanceof RequestError && error.code === AUTH_REQUIRED)
        throw new Error(`Sign in to ${this.agent.name} in a terminal, then send again.`, {
          cause: error,
        });
      throw error;
    }

    const { sessionId } = session;
    this.#options.set(sessionId, session.configOptions ?? []);

    if (this.agent.mode !== undefined)
      await this.#connection.agent.request(methods.agent.session.setMode, {
        sessionId,
        modeId: this.agent.mode,
      });

    const thread = new AcpThread(`acp-${randomUUID().slice(0, 8)}-`, {
      cwd,
      dialect: this.#dialect,
      approve,
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

  /** The session's configuration options as the agent last reported them. */
  configOptions(thread: AcpThread): readonly SessionConfigOption[] {
    return this.#options.get(this.#sessionId(thread)) ?? [];
  }

  async configure(
    thread: AcpThread,
    configId: string,
    value: string,
  ): Promise<readonly SessionConfigOption[]> {
    const sessionId = this.#sessionId(thread);

    const { configOptions } = await this.#connection.agent.request(
      methods.agent.session.setConfigOption,
      { sessionId, configId, value },
    );

    this.#options.set(sessionId, configOptions);

    return configOptions;
  }

  async choose(thread: AcpThread, choice: AgentChoice): Promise<void> {
    for (const [category, value] of [
      ["model", choice.model],
      ["thought_level", choice.thought],
    ] as const) {
      const option = findOption(this.configOptions(thread), category);

      if (value === undefined || option?.currentValue === value) continue;

      if (option === undefined || !choices(option).some((entry) => entry.value === value))
        throw new Error(`${this.agent.name} no longer offers ${value}. Pick another model.`);
      await this.configure(thread, option.id, value);
    }
  }

  forget(thread: AcpThread): void {
    for (const [id, known] of this.#threads)
      if (known === thread) {
        this.#threads.delete(id);
        this.#options.delete(id);

        for (const [child, parent] of this.#parentSessions) {
          if (parent === id) this.#parentSessions.delete(child);
        }
        thread.close();
      }
  }

  close(reason: Error = new Error(`${this.agent.name} closed.`)): void {
    if (this.#failure !== undefined) return;
    this.#failure = reason;

    for (const thread of this.#threads.values()) thread.close(reason);
    this.#threads.clear();
    this.#parentSessions.clear();
    this.#options.clear();
    this.#connection.close();
    void this.#pipe.stop().catch(() => undefined);
  }

  #takeUpdate(sessionId: string, update: SessionUpdate): void {
    const parent = this.#parentSessions.get(sessionId);

    if (parent !== undefined) {
      this.#threads.get(parent)?.update(update, sessionId);

      return;
    }

    if (update.sessionUpdate === "config_option_update") {
      this.#options.set(sessionId, update.configOptions);
    }

    if (update.sessionUpdate === "subagent_update") {
      this.#parentSessions.set(update.sessionId, sessionId);
    }

    this.#threads.get(sessionId)?.update(update, this.#dialect.findSubagent(update));
  }

  async #askPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const parent = this.#parentSessions.get(request.sessionId);

    const subagent =
      parent === undefined
        ? this.#dialect.findSubagent({ sessionUpdate: "tool_call_update", ...request.toolCall })
        : request.sessionId;

    const thread = this.#threads.get(parent ?? request.sessionId);

    return (await thread?.permission(request, subagent)) ?? { outcome: { outcome: "cancelled" } };
  }

  async #askForm(request: unknown): Promise<CreateElicitationResponse> {
    if (!Value.Check(formRequest, request) || request.sessionId === undefined) {
      return { action: "decline" };
    }

    const parent = this.#parentSessions.get(request.sessionId);
    const thread = this.#threads.get(parent ?? request.sessionId);

    return thread === undefined ? { action: "decline" } : thread.askForm(request);
  }

  private newSession(cwd: string) {
    return this.#connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
  }

  #sessionId(thread: AcpThread): string {
    for (const [id, known] of this.#threads) if (known === thread) return id;

    throw this.#failure ?? new Error(`${this.agent.name} closed this session.`);
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
