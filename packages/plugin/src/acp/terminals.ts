import type {
  CreateTerminalRequest,
  TerminalOutputResponse,
  WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk/unstable";
import { RequestError } from "@agentclientprotocol/sdk/unstable";
import type { ExecutionEnv, Job } from "@nyte-ai/core";
import type { ProviderHeadRequest } from "@nyte-ai/ai";
import type { JobEnd } from "@nyte-ai/schema";
import { posix } from "node:path";
import { MIRROR_TOOL } from "./projection.ts";

interface Terminal {
  readonly job: Job;
  readonly limit: number;
  readonly tail: { text: string; truncated: boolean };
  readonly done: Promise<JobEnd>;
  state:
    | { readonly kind: "running" }
    | { readonly kind: "exited"; readonly end: JobEnd }
    | { readonly kind: "released" };
}

export function clientTerminals(
  env: ExecutionEnv,
  signal: AbortSignal,
  scope: () => ProviderHeadRequest | undefined,
) {
  const terminals = new Map<string, Terminal>();

  const find = (id: string): Terminal => {
    const terminal = terminals.get(id);

    if (signal.aborted || terminal === undefined || terminal.state.kind === "released") {
      throw RequestError.invalidParams("No terminal belongs to this session with that id.");
    }
    return terminal;
  };

  const release = async (id: string) => {
    const terminal = terminals.get(id);

    if (terminal === undefined || terminal.state.kind === "released") return;
    const running = terminal.state.kind === "running";
    terminal.state = { kind: "released" };
    terminals.delete(id);

    if (running) await terminal.job.stop();
    await terminal.job.close();
  };

  const close = () => Promise.all([...terminals.keys()].map(release)).then(() => undefined);
  signal.addEventListener(
    "abort",
    () => {
      void close();
    },
    { once: true },
  );

  return {
    async create(request: CreateTerminalRequest) {
      const active = scope();

      if (signal.aborted || active === undefined || active.lifetime.aborted) {
        throw RequestError.requestCancelled();
      }
      if (terminals.size >= 16) {
        throw RequestError.invalidParams("This agent already owns too many terminals.");
      }
      const cwd = request.cwd ?? env.cwd;
      const root = posix.resolve(env.cwd);
      const resolved = posix.resolve(cwd);

      if (resolved !== root && !resolved.startsWith(`${root}/`)) {
        throw RequestError.invalidParams("The terminal cwd is outside the workspace.");
      }
      const overrides = request.env ?? [];

      if (
        new Set(overrides.map((entry) => entry.name)).size !== overrides.length ||
        overrides.some(
          (entry) =>
            /^(?:NYTE_|NODE_|ELECTRON_|LD_|DYLD_)/u.test(entry.name) ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry.name),
        )
      ) {
        throw RequestError.invalidParams(
          "The terminal environment contains reserved or duplicate names.",
        );
      }
      const limit = request.outputByteLimit ?? 1024 * 1024;

      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 4 * 1024 * 1024 ||
        request.command.includes("\0")
      ) {
        throw RequestError.invalidParams("Invalid terminal command or output limit.");
      }
      const args = request.args ?? [];
      const command = args.length === 0 ? request.command : [request.command, ...args];
      const display = typeof command === "string" ? command : command.join(" ");

      const verdict = await active.tools.authorize({
        operation: crypto.randomUUID(),
        name: MIRROR_TOOL,
        subjectName: "execute",
        class: { kind: "shell", command: display },
        args: {
          command: display,
          cwd: resolved,
          environmentNames: overrides.map((entry) => entry.name),
        },
        signal,
      });

      if (
        verdict.kind !== "allow" ||
        signal.aborted ||
        active.lifetime.aborted ||
        scope() !== active
      ) {
        throw RequestError.requestCancelled();
      }
      const job = await env.exec(command, {
        cwd: resolved,
        env: Object.fromEntries(overrides.map((entry) => [entry.name, entry.value])),
        signal: AbortSignal.any([signal, active.lifetime]),
      });

      if (signal.aborted || active.lifetime.aborted) {
        await job.stop();
        throw RequestError.requestCancelled();
      }

      const id = crypto.randomUUID();
      const tail = { text: "", truncated: false };

      const terminal: Terminal = {
        job,
        limit,
        tail,
        done: job.settled(),
        state: { kind: "running" },
      };

      terminals.set(id, terminal);
      void consume(terminal);
      void terminal.done.then((end) => {
        if (terminal.state.kind !== "released") terminal.state = { kind: "exited", end };
      });

      return { terminalId: id };
    },
    output(id: string): TerminalOutputResponse {
      const terminal = find(id);

      return {
        output: terminal.tail.text,
        truncated: terminal.tail.truncated,
        ...(terminal.state.kind === "exited" ? { exitStatus: exitStatus(terminal.state.end) } : {}),
      };
    },
    async wait(id: string): Promise<WaitForTerminalExitResponse> {
      const terminal = find(id);
      const end = await terminal.done;
      find(id);

      return exitStatus(end);
    },
    async kill(id: string) {
      await find(id).job.stop();

      return {};
    },
    async release(id: string) {
      await release(id);

      return {};
    },
    close,
  };
}

async function consume(terminal: Terminal): Promise<void> {
  const decoder = new TextDecoder();

  for await (const frame of terminal.job.output()) {
    if (terminal.state.kind === "released") return;

    if (frame.kind === "gap") terminal.tail.truncated = true;

    if (frame.kind !== "bytes") continue;
    const text = terminal.tail.text + decoder.decode(frame.data, { stream: true });
    const bytes = new TextEncoder().encode(text);
    terminal.tail.truncated ||= bytes.length > terminal.limit;
    const start = Math.max(0, bytes.length - terminal.limit);
    const boundary = bytes.findIndex((byte, index) => index >= start && (byte & 0xc0) !== 0x80);
    terminal.tail.text = new TextDecoder().decode(
      bytes.subarray(boundary < 0 ? bytes.length : boundary),
    );
  }
}

function exitStatus(end: JobEnd): WaitForTerminalExitResponse {
  return end.kind === "exited" ? { exitCode: end.code } : {};
}
