import { CLIP_CHARS, clipText } from "@nyte-ai/core";
import type { Job, ToolDefinition, ToolInvocation, Workspace } from "@nyte-ai/core";
import { asId, compile, JobEndType, SdkError, standard } from "@nyte-ai/schema";
import type { ActionDeclaration, Infer, JobEnd, JobId, Json, PrincipalId } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { Plugin } from "@nyte-ai/plugin/core";
import type { ClientActions } from "./browser-client.ts";

export const MACHINE_ACTION = {
  name: "machine.exec",
  summary: "Runs a shell command on this machine for the agent of a chat its user sent.",
  input: { type: "object" },
} as const satisfies ActionDeclaration;

const PERFORM_MS = 20_000;

const READ_MS = 5000;

const FOREGROUND_MS = 120_000;

const JobField = Type.String({ minLength: 1 });

const MachineCallType = Type.Union([
  Type.Object({ method: Type.Literal("start"), job: JobField, command: Type.String() }),
  Type.Object({
    method: Type.Literal("read"),
    job: JobField,
    from: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({ method: Type.Literal("stop"), job: JobField }),
]);

type MachineCall = Static<typeof MachineCallType>;

const answers = {
  call: compile(MachineCallType),
  start: compile(Type.Object({ machine: Type.String() })),
  read: compile(
    Type.Object({
      text: Type.String(),
      next: Type.Integer({ minimum: 0 }),
      end: Type.Union([JobEndType, Type.Null()]),
    }),
  ),
};

const localBashParameters = standard(
  Type.Object({
    command: Type.String({ description: "The command, run by the machine's login shell." }),
    description: Type.Optional(
      Type.String({ description: "Clear, concise description of what it does, in 5-10 words." }),
    ),
    timeout: Type.Optional(
      Type.Number({
        description: `Milliseconds before the command is stopped. Default ${FOREGROUND_MS.toLocaleString("en-US")}.`,
        minimum: 1,
      }),
    ),
  }),
);

/**
 * Gives a chat's agent `local_bash`, which runs one command on the computer of the person who sent
 * the chat's latest message: the client connected as them that offers `machine.exec`.
 */
export function machineBridgePlugin(actions: ClientActions): Plugin {
  const localBash: ToolDefinition<Infer<typeof localBashParameters>> = {
    name: "local_bash",
    description:
      "Run one shell command on the user's own computer, not in this workspace, and return its output and exit code. It runs on the computer of the person who sent the latest message, in the folder they shared, so use it only for what needs their machine: their local checkout, credentials, devices or apps. Each call starts a new shell. The command gets no input.",
    parameters: localBashParameters,
    class: (args) =>
      args.description === undefined
        ? { kind: "shell", command: args.command }
        : { kind: "shell", command: args.command, description: args.description },
    changes: "none",
    rerun: "never",
    execute: async (args, invocation) => ({
      content: [{ kind: "text", text: await runLocally(actions, args, invocation) }],
    }),
  };

  return { id: "machine-bridge", contribute: { tools: [localBash] } };
}

async function runLocally(
  actions: ClientActions,
  args: Infer<typeof localBashParameters>,
  invocation: ToolInvocation,
): Promise<string> {
  const sender = await invocation.sender();

  if (sender === null) {
    return "No message in this chat names its sender, so there is no computer to run on.";
  }

  if (!actions.offered(MACHINE_ACTION.name, sender)) {
    return "The person who sent the latest message has no computer connected to this host.";
  }

  const job = asId<"job">(invocation.call);
  const ask = (call: MachineCall): Promise<Json> => perform(actions, sender, call);

  const { machine } = decode(
    answers.start,
    await ask({ method: "start", job, command: args.command }),
  );

  const stop = (): void => void ask({ method: "stop", job }).catch(() => undefined);
  const deadline = AbortSignal.timeout(args.timeout ?? FOREGROUND_MS);
  const ended = AbortSignal.any([invocation.signal, deadline]);
  ended.addEventListener("abort", stop, { once: true });

  try {
    let output = "";
    let from = 0;

    for (;;) {
      const read = decode(answers.read, await ask({ method: "read", job, from }));
      output = keepTail(output + read.text);
      from = read.next;
      invocation.progress({ text: output.slice(-2000) });

      if (read.end !== null) {
        return render(
          output,
          deadline.aborted
            ? `[stopped on ${machine} after ${(args.timeout ?? FOREGROUND_MS) / 1000} s; pass a larger timeout if it needs longer]`
            : describeEnd(read.end, machine),
        );
      }
    }
  } finally {
    ended.removeEventListener("abort", stop);
  }
}

function perform(actions: ClientActions, sender: PrincipalId, call: MachineCall): Promise<Json> {
  return actions.perform(MACHINE_ACTION.name, call, PERFORM_MS, sender);
}

function keepTail(output: string): string {
  return output.length > CLIP_CHARS * 2 ? output.slice(-CLIP_CHARS * 2) : output;
}

function render(output: string, footer: string): string {
  const body = clipText(output.trimEnd(), "tail");

  return body === "" ? footer : `${body}\n${footer}`;
}

function describeEnd(end: JobEnd, machine: string): string {
  if (end.kind === "lost") return `[the process on ${machine} was lost]`;

  return `[exit code ${end.code ?? "none"} on ${machine}${end.reason === "exited" ? "" : `, ${end.reason}`}]`;
}

function decode<T>(checker: { Check(value: unknown): value is T }, value: Json): T {
  if (!checker.Check(value)) {
    throw new SdkError("invalid", "The computer answered local_bash with something unreadable.");
  }

  return value;
}

interface Running {
  readonly job: Job;
  text: string;
  dropped: number;
  end: { readonly at: number; readonly how: JobEnd } | null;
  changed: PromiseWithResolvers<void>;
}

const KEEP_ENDED_MS = 10 * 60_000;

/**
 * Answers `machine.exec` for the client that offers it: each command runs as a job in `workspace`,
 * keyed by the id the agent's host sent, so a repeated start finds the job the first one started.
 * It refuses a request asked for anyone but `principal`, the user the client connected as.
 */
export function answerMachine(input: {
  readonly workspace: Workspace;
  readonly principal: PrincipalId;
  readonly machine: string;
}): (call: Json, requester: { readonly principal: PrincipalId }) => Promise<Json> {
  const running = new Map<JobId, Running>();

  const follow = async (entry: Running): Promise<void> => {
    const decoder = new TextDecoder();

    for await (const frame of entry.job.output()) {
      if (frame.kind !== "bytes") continue;
      entry.text += decoder.decode(frame.data, { stream: true });

      if (entry.text.length > CLIP_CHARS * 2) {
        const cut = entry.text.length - CLIP_CHARS * 2;
        entry.text = entry.text.slice(cut);
        entry.dropped += cut;
      }

      wake(entry);
    }

    entry.end = { at: Date.now(), how: await entry.job.settled() };
    wake(entry);
  };

  const start = async (id: JobId, command: string): Promise<Running> => {
    const known = running.get(id);

    if (known !== undefined) return known;

    for (const [ended, entry] of running) {
      if (entry.end !== null && Date.now() - entry.end.at > KEEP_ENDED_MS) running.delete(ended);
    }

    const job = await input.workspace.jobs.start({ command, id, title: command });

    const entry: Running = {
      job,
      text: "",
      dropped: 0,
      end: null,
      changed: Promise.withResolvers(),
    };

    running.set(id, entry);
    void follow(entry).catch(() => {
      entry.end = { at: Date.now(), how: { kind: "lost" } };
      wake(entry);
    });

    return entry;
  };

  return async (call, requester) => {
    if (requester.principal !== input.principal) {
      throw new SdkError("denied", "This computer runs commands only for its own user.");
    }

    if (!answers.call.Check(call)) {
      throw new SdkError("invalid", "That is not a machine.exec call.");
    }

    const id = asId<"job">(call.job);

    if (call.method === "start") {
      await start(id, call.command);
      const started: Json = { machine: input.machine };

      return started;
    }

    const entry = running.get(id);

    if (entry === undefined) throw new SdkError("unknown", `This computer runs no job ${id}.`);

    if (call.method === "stop") {
      await entry.job.stop();

      return null;
    }

    if (entry.end === null && entry.dropped + entry.text.length <= call.from) {
      await Promise.race([
        entry.changed.promise,
        new Promise((resolve) => setTimeout(resolve, READ_MS)),
      ]);
    }

    const read: Json = {
      text: entry.text.slice(Math.max(0, call.from - entry.dropped)),
      next: entry.dropped + entry.text.length,
      end: entry.end?.how ?? null,
    };

    return read;
  };
}

function wake(entry: Running): void {
  entry.changed.resolve();
  entry.changed = Promise.withResolvers();
}
