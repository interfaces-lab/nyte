import { spawn } from "node:child_process";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk/unstable";
import type {
  ClientConnection,
  ContentBlock,
  CreateElicitationResponse,
  InitializeResponse,
  McpServer,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionModeState,
  SessionUpdate,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from "@agentclientprotocol/sdk/unstable";
import { processEnvironment } from "@nyte-ai/core";
import type { ExecutionEnv, Job } from "@nyte-ai/core";
import manifest from "../../package.json" with { type: "json" };
import type { AcpAgent, AcpLaunch, AgentContract } from "./profiles.ts";
import { negotiate, standardProfile } from "./profiles.ts";
import type { SubagentReport } from "./codecs/agents.ts";

export interface AgentChoice {
  readonly model: string | undefined;
  readonly thought: string | undefined;
}

export interface ProcessSink {
  update(update: SessionUpdate, child?: string): void;
  child(report: SubagentReport): void;
  permission(request: RequestPermissionRequest, child?: string): Promise<RequestPermissionResponse>;
  form(request: unknown): Promise<CreateElicitationResponse>;
  failed(error: Error): void;
}

export interface ProcessServices {
  readonly read?: (request: ReadTextFileRequest) => Promise<ReadTextFileResponse>;
  readonly terminals?: ReturnType<typeof clientTerminals>;
}

import type { clientTerminals } from "./terminals.ts";

interface Pipe {
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
  readonly ended: Promise<string>;
  stop(): Promise<unknown>;
}

type Route =
  | {
      readonly kind: "opening";
      readonly native: string | null;
      readonly staged: readonly { readonly session: string; readonly update: SessionUpdate }[];
      readonly replay: boolean;
    }
  | { readonly kind: "active"; readonly native: string }
  | { readonly kind: "retired" };

const DEADLINE = 10_000;

const CANCEL_GRACE = 1000;

const denied: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

export function choices(
  option: SessionConfigOption | undefined,
): readonly SessionConfigSelectOption[] {
  return option?.type === "select"
    ? option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]))
    : [];
}

export function findOption(
  options: readonly SessionConfigOption[],
  category: "model" | "thought_level",
): SessionConfigOption | undefined {
  return options.find((option) => option.category === category && option.type === "select");
}

export class AgentProcess {
  private readonly connection: ClientConnection;
  private readonly pipe: Pipe;
  private readonly ready: Promise<InitializeResponse>;
  private readonly sink: ProcessSink;
  private route: Route = { kind: "opening", native: null, staged: [], replay: false };
  private readonly parents = new Map<string, string>();
  private readonly unknown = new Map<string, readonly SessionUpdate[]>();
  private options: readonly SessionConfigOption[] = [];
  private failure: Error | undefined;
  private auth: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private stderr = "";
  private contract: AgentContract | undefined;
  readonly agent: AcpAgent;
  readonly launch: AcpLaunch;

  private constructor(
    agent: AcpAgent,
    launch: AcpLaunch,
    sink: ProcessSink,
    connect: (stderr: (bytes: Uint8Array) => void) => Pipe,
    services: ProcessServices = {},
  ) {
    this.agent = agent;
    this.launch = launch;
    this.sink = sink;
    const codec = (agent.behavior ?? standardProfile).codec();

    const base = client({ name: "nyte" })
      .onNotification(methods.client.session.update, (context) =>
        this.ingest(context.params.sessionId, context.params.update),
      )
      .onRequest(methods.client.session.requestPermission, (context) => {
        const root = this.root(context.params.sessionId);

        if (this.route.kind !== "active" || root !== this.route.native) return denied;

        return this.sink.permission(
          context.params,
          root === context.params.sessionId ? undefined : context.params.sessionId,
        );
      })
      .onRequest(methods.client.elicitation.create, (context) =>
        this.route.kind === "active" ? this.sink.form(context.params) : { action: "decline" },
      );

    const serviced = base
      .onRequest(methods.client.fs.readTextFile, (context) => {
        if (!this.owns(context.params.sessionId) || services.read === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.read(context.params);
      })
      .onRequest(methods.client.terminal.create, (context) => {
        if (!this.owns(context.params.sessionId) || services.terminals === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.terminals.create(context.params);
      })
      .onRequest(methods.client.terminal.output, (context) => {
        if (!this.owns(context.params.sessionId) || services.terminals === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.terminals.output(context.params.terminalId);
      })
      .onRequest(methods.client.terminal.waitForExit, (context) => {
        if (!this.owns(context.params.sessionId) || services.terminals === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.terminals.wait(context.params.terminalId);
      })
      .onRequest(methods.client.terminal.kill, (context) => {
        if (!this.owns(context.params.sessionId) || services.terminals === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.terminals.kill(context.params.terminalId);
      })
      .onRequest(methods.client.terminal.release, (context) => {
        if (!this.owns(context.params.sessionId) || services.terminals === undefined) {
          throw RequestError.requestCancelled();
        }
        return services.terminals.release(context.params.terminalId);
      });

    const app = [...codec.notifications].reduce(
      (built, [method, decode]) =>
        built.onNotification(
          method,
          (value: unknown) => value,
          (context) => {
            const report = decode(context.params);

            if (
              report !== undefined &&
              this.route.kind === "active" &&
              report.sessionId === this.route.native
            ) {
              this.sink.child(report);
            }
          },
        ),
      serviced,
    );

    const decoder = new TextDecoder();
    this.pipe = connect((bytes) => {
      this.stderr = (this.stderr + decoder.decode(bytes, { stream: true })).slice(-4096);
    });
    this.connection = app.connect(
      ndJsonStream(this.pipe.input, this.pipe.output, { maxMessageBytes: 4 * 1024 * 1024 }),
    );
    void this.pipe.ended.then((end) =>
      this.fail(new Error(`${agent.name} exited${end}.${this.detail()}`)),
    );
    void this.connection.closed.then(() => {
      if (this.failure === undefined) {
        this.fail(new Error(`${agent.name}'s protocol stream closed.${this.detail()}`));
      }
    });
    this.ready = this.bounded(
      this.connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: services.read !== undefined, writeTextFile: false },
          terminal: services.terminals !== undefined,
          subagents: {},
          elicitation: { form: {} },
          ...(codec.capabilityMeta === undefined ? {} : { _meta: codec.capabilityMeta }),
        },
        clientInfo: { name: "nyte", title: "Nyte", version: manifest.version },
      }),
    ).then((peer) => {
      this.contract = negotiate(agent.behavior ?? standardProfile, peer);

      return peer;
    });
    void this.ready.catch((error: unknown) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
  }

  static async start(
    env: ExecutionEnv,
    agent: AcpAgent,
    launch: AcpLaunch,
    sink: ProcessSink,
    services?: ProcessServices,
  ): Promise<AgentProcess> {
    await processEnvironment();

    const job = await env.exec([agent.command, ...launch.args], {
      env: { ...agent.env },
      stdio: "protocol",
    });

    return new AgentProcess(agent, launch, sink, (stderr) => jobPipe(job, stderr), services);
  }

  static spawn(agent: AcpAgent, cwd: string): AgentProcess {
    const child = spawn(agent.command, [...agent.launch.args], {
      cwd,
      env: { ...process.env, ...agent.env },
      stdio: "pipe",
    });

    return new AgentProcess(
      agent,
      agent.launch,
      {
        update: () => {},
        child: () => {},
        permission: async () => denied,
        form: async () => ({ action: "decline" }),
        failed: () => {},
      },
      (stderr) => {
        child.stderr.on("data", (chunk: Buffer) => stderr(chunk));

        const ended = new Promise<string>((resolve) =>
          child.once("exit", (code, signal) =>
            resolve(
              code === null
                ? signal === null
                  ? ""
                  : ` with signal ${signal}`
                : ` with code ${code}`,
            ),
          ),
        );

        const input = new WritableStream<Uint8Array>({
          write: (bytes) =>
            new Promise<void>((resolve, reject) =>
              child.stdin.write(bytes, (error) => (error ? reject(error) : resolve())),
            ),
        });

        let open = true;

        const output = new ReadableStream<Uint8Array>({
          start(controller) {
            child.stdout.on("data", (chunk: Buffer) => {
              if (open) controller.enqueue(chunk);
            });
            child.stdout.once("end", () => {
              if (open) {
                open = false;
                controller.close();
              }
            });
            child.once("error", (error) => {
              if (open) {
                open = false;
                controller.error(error);
              }
            });
          },
          cancel() {
            open = false;
          },
        });

        return {
          input,
          output,
          ended,
          async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const force = setTimeout(() => child.kill("SIGKILL"), CANCEL_GRACE);
            child.kill();
            await ended;
            clearTimeout(force);
          },
        };
      },
    );
  }

  get closed(): boolean {
    return this.route.kind === "retired";
  }
  get native(): string {
    if (this.route.kind !== "active") {
      throw this.failure ?? new Error("The agent has no active session.");
    }
    return this.route.native;
  }
  get negotiated(): AgentContract {
    if (this.contract === undefined) throw new Error("The agent has not initialized.");

    return this.contract;
  }
  configOptions(): readonly SessionConfigOption[] {
    return this.options;
  }

  async open(input: {
    readonly cwd: string;
    readonly resume?: string;
    readonly system?: string;
    readonly mcpServers?: (peer: InitializeResponse) => readonly McpServer[];
  }): Promise<void> {
    const peer = await this.ready;
    const contract = this.negotiated;
    const native = input.resume;

    if (native !== undefined && contract.reopen === "off") {
      throw new Error(`${this.agent.name} cannot safely resume this session.`);
    }
    this.route = {
      kind: "opening",
      native: native ?? null,
      staged: [],
      replay: native !== undefined && contract.reopen === "load",
    };

    if (
      this.agent.auth !== undefined &&
      peer.authMethods?.some((method) => method.id === this.agent.auth)
    ) {
      await this.authenticate();
    }
    const params = {
      cwd: input.cwd,
      mcpServers: [...(input.mcpServers?.(peer) ?? [])],
      ...(contract.systemAppend && native === undefined && input.system !== undefined
        ? { _meta: { antigravity: { systemPrompt: { append: input.system } } } }
        : {}),
    };

    const setup = async (): Promise<{
      sessionId: string;
      configOptions?: SessionConfigOption[] | null;
      modes?: SessionModeState | null;
    }> => {
      if (native === undefined) {
        return this.connection.agent.request(methods.agent.session.new, params);
      }
      if (contract.reopen === "resume") {
        return {
          ...(await this.connection.agent.request(methods.agent.session.resume, {
            ...params,
            sessionId: native,
          })),
          sessionId: native,
        };
      }
      return {
        ...(await this.connection.agent.request(methods.agent.session.load, {
          ...params,
          sessionId: native,
        })),
        sessionId: native,
      };
    };

    const session = await this.signedIn(setup);

    if (this.route.kind !== "opening") {
      throw this.failure ?? new Error("The agent was retired during setup.");
    }
    const id = "sessionId" in session ? session.sessionId : native;

    if (id === undefined) throw new Error("The agent omitted its session id.");
    this.options = session.configOptions ?? this.options;

    if (this.launch.mode !== undefined) {
      if (!session.modes?.availableModes.some((mode) => mode.id === this.launch.mode)) {
        throw new Error(`${this.agent.name} does not offer the required ${this.launch.mode} mode.`);
      }
      await this.bounded(
        this.connection.agent.request(methods.agent.session.setMode, {
          sessionId: id,
          modeId: this.launch.mode,
        }),
      );
    }

    const staged = this.route;
    this.route = { kind: "active", native: id };

    if (!staged.replay) {
      staged.staged
        .filter((entry) => entry.session === id)
        .forEach((entry) => this.ingest(entry.session, entry.update));
    }
  }

  async configure(configId: string, value: string): Promise<readonly SessionConfigOption[]> {
    const configured = await this.bounded(
      this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: this.native,
        configId,
        value,
      }),
    );

    this.options = configured.configOptions;

    return this.options;
  }
  async choose(choice: AgentChoice): Promise<void> {
    await [
      { category: "model" as const, value: choice.model },
      { category: "thought_level" as const, value: choice.thought },
    ].reduce(async (previous, selected) => {
      await previous;

      if (selected.value === undefined) return;
      const option = findOption(this.options, selected.category);

      if (
        option === undefined ||
        !choices(option).some((entry) => entry.value === selected.value)
      ) {
        throw new Error(`${this.agent.name} no longer offers ${selected.value}.`);
      }
      if (option.currentValue !== selected.value) await this.configure(option.id, selected.value);
    }, Promise.resolve());
  }
  prompt(blocks: readonly ContentBlock[]): Promise<PromptResponse> {
    return this.connection.agent
      .request(methods.agent.session.prompt, { sessionId: this.native, prompt: [...blocks] })
      .catch((error: unknown) => {
        if (error instanceof RequestError && error.code === -32_000) {
          throw new Error(
            `Sign in to ${this.agent.name} in a terminal. The request may already have run; it was not resent.`,
            { cause: error },
          );
        }
        throw error;
      });
  }
  async cancel(): Promise<void> {
    if (this.route.kind !== "active") return this.close();
    await this.bounded(
      this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.route.native }),
    );
  }
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.route = { kind: "retired" };
    this.parents.clear();
    this.unknown.clear();
    this.connection.close();
    this.closing = this.pipe.stop().then(() => undefined);

    return this.closing;
  }
  private authenticate(): Promise<void> {
    return (this.auth ??= this.bounded(
      this.connection.agent.request(methods.agent.authenticate, {
        methodId: this.agent.auth ?? "",
      }),
    ).then(() => undefined));
  }
  private async signedIn<T>(operation: () => Promise<T>): Promise<T> {
    return this.bounded(operation()).catch(async (error: unknown) => {
      if (
        !(error instanceof RequestError) ||
        error.code !== -32_000 ||
        this.agent.auth === undefined ||
        this.auth !== undefined
      ) {
        throw error;
      }
      await this.authenticate();

      return this.bounded(operation());
    });
  }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`${this.agent.name} did not complete protocol setup in time.`);
            this.fail(error);
            reject(error);
          }, DEADLINE);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private fail(error: Error): void {
    if (this.failure !== undefined || this.route.kind === "retired") return;
    this.failure = error;
    void this.close();
    this.sink.failed(error);
  }
  private owns(session: string): boolean {
    return this.route.kind === "active" && this.route.native === session;
  }
  private root(session: string): string {
    const seen = new Set<string>();
    let current = session;

    while (this.parents.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.parents.get(current) ?? current;
    }

    return current;
  }
  private ingest(session: string, update: SessionUpdate): void {
    if (this.route.kind === "retired") return;

    if (this.route.kind === "opening") {
      if (update.sessionUpdate === "config_option_update") this.options = update.configOptions;

      if (this.route.staged.length >= 128) {
        return this.fail(new Error("The agent sent too much output during setup."));
      }
      this.route = { ...this.route, staged: [...this.route.staged, { session, update }] };

      return;
    }

    const root = this.root(session);

    if (root !== this.route.native) {
      const entries = this.unknown.get(session) ?? [];

      if (entries.length >= 128 || this.unknown.size >= 32) {
        return this.fail(new Error("The agent sent too much unowned child output."));
      }
      this.unknown.set(session, [...entries, update]);

      return;
    }

    if (update.sessionUpdate === "subagent_update") {
      if (
        (this.parents.has(update.sessionId) && this.parents.get(update.sessionId) !== session) ||
        update.sessionId === session ||
        this.root(session) === update.sessionId
      ) {
        return;
      }
      this.parents.set(update.sessionId, session);
      this.sink.update(update, root === session ? undefined : session);
      const pending = this.unknown.get(update.sessionId) ?? [];
      this.unknown.delete(update.sessionId);
      pending.forEach((entry) => this.ingest(update.sessionId, entry));

      return;
    }

    if (update.sessionUpdate === "config_option_update") this.options = update.configOptions;
    this.sink.update(update, root === session ? undefined : session);
  }
  private detail(): string {
    const tail = this.stderr.trim().slice(-500);

    return tail === "" ? "" : ` (${tail})`;
  }
}

function jobPipe(job: Job, stderr: (bytes: Uint8Array) => void): Pipe {
  return {
    input: new WritableStream<Uint8Array>({ write: (bytes) => job.write(bytes) }),
    output: new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const frame of job.output()) {
          if (frame.kind === "gap") {
            controller.error(new Error("The agent's protocol output lost bytes."));

            return;
          }

          if (frame.kind !== "bytes") continue;

          if (frame.stream === "stderr") stderr(frame.data);
          else controller.enqueue(frame.data);
        }

        controller.close();
      },
    }),
    ended: job
      .settled()
      .then((end) =>
        end.kind === "exited"
          ? end.code === null
            ? ""
            : ` with code ${end.code}`
          : " unexpectedly",
      ),
    stop: () => job.stop(),
  };
}
