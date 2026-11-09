import { definePart } from "@nyte-ai/core";
import type {
  ActionContext,
  ActionOutput,
  Command,
  ExecutionEnv,
  Part,
  PluginApi,
  SettingDefinition,
  ToolDefinition,
} from "@nyte-ai/core";
import { asId, SdkError } from "@nyte-ai/schema";
import type { Awaitable, HeadName, Infer, WorkspaceId } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import {
  REMOVE_SECRET_COMMAND,
  SAVE_SECRET_COMMAND,
  SAVED_SECRETS,
  SECRET_DIRECTORY,
  SECRET_TOOL,
  readSecret,
  saveInput,
  saveRequest,
  savedSecrets,
  secret as secretContract,
  secretParameters,
} from "./schema.ts";
import type { SaveRequest, SavedSecrets, SecretPhase, SecretState } from "./schema.ts";

const WAIT_MS = 10 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

const SWEEP_MS = 60 * 60_000;

const WRITE_FILE = `umask 077
dir="$HOME/.nyte/secrets/$1"
mkdir -p "$dir" && printf %s "$NYTE_SECRET_VALUE" > "$dir/$2" && printf %s "$HOME"`;

const REMOVE_DIRECTORIES = 'cd "$HOME/.nyte/secrets" 2>/dev/null || exit 0; rm -rf -- "$@"';

const saved: SettingDefinition<SavedSecrets> = {
  id: SAVED_SECRETS,
  label: "Saved secrets",
  schema: savedSecrets,
  default: {},
  scope: "host",
};

type Actions = typeof secretContract.actions;

type Handlers = {
  readonly [A in keyof Actions]: (
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<SecretState, Actions>,
  ) => Awaitable<ActionOutput<Actions[A]>>;
};

function describeSaved(name: string, path: string, expiresAt: number | null): string {
  const lifetime =
    expiresAt === null
      ? "It stays until the user deletes it."
      : `Nyte deletes it after ${new Date(expiresAt).toISOString()}.`;

  return `The user saved ${name} to ${path}. ${lifetime}\nRead it only inside the command that needs it, and never print it or copy it into a file, message or log:\n  ${name}="$(cat '${path}')" <command>`;
}

const handlers: Handlers = {
  async save(input, context) {
    let saved: { readonly name: string; readonly phase: SecretPhase } | undefined;

    const outcome = await context.part.update((current) => {
      const phase = current.phase;

      if (phase.kind === "skipped") throw new SdkError("invalid", "This request was dismissed.");

      if (phase.kind === "saved") {
        saved = { name: current.name, phase };

        return current;
      }

      const next: SecretPhase = {
        kind: "saved",
        path: input.path,
        expiresAt: input.expiresAt,
        head: phase.kind === "open" ? phase.head : null,
      };

      saved = { name: current.name, phase: next };

      return { ...current, phase: next };
    });

    if (outcome.kind !== "updated")
      throw new Error(`The secret could not be recorded: ${outcome.kind}.`);

    if (saved?.phase.kind !== "saved" || saved.phase.head === null) return;

    await context.api.sdk
      .session(context.session)
      .head(saved.phase.head)
      .send(describeSaved(saved.name, saved.phase.path, saved.phase.expiresAt), {
        delivery: "attach",
        source: { kind: "answer", part: context.part.id, label: `Saved ${saved.name}` },
        id: asId<"receipt">(`secret:${context.part.id}`),
      });
  },
  async skip(_, context) {
    const outcome = await context.part.update((current) => {
      const phase = current.phase;

      if (phase.kind === "saved") throw new SdkError("invalid", "This secret was saved.");

      if (phase.kind === "skipped") return current;

      return { ...current, phase: { kind: "skipped", late: phase.kind === "open" } };
    });

    if (outcome.kind !== "updated")
      throw new Error(`The request could not be dismissed: ${outcome.kind}.`);
  },
};

export const secret = definePart({
  ...secretContract,
  onAction: (action, input, context) => handlers[action](input, context),
});

const request: ToolDefinition<Infer<typeof secretParameters>> = {
  name: SECRET_TOOL,
  description:
    "Ask the user for one API key, token or password, and wait up to ten minutes. Call it instead of asking in chat; one secret per call. The user pastes it into the app, which saves it to an owner-only file and returns the file's path; you never see the value. Read the file only inside the command that needs it and never print it. Put a sign-up or settings link in url.",
  parameters: secretParameters,
  class: (args) => ({ kind: "custom", label: args.name }),
  effects: "none",
  approval: "never",
  replay: "safe",
  async execute(args, invocation) {
    const part = await invocation.session.parts.create(secret, {
      state: {
        call: invocation.call,
        name: args.name,
        label: args.label,
        reason: args.reason,
        url: args.url ?? null,
        phase: { kind: "asking" },
      },
      placement: { kind: "modal" },
    });

    const outcome = await invocation.wait({
      kind: "part",
      part: part.id,
      deadline: invocation.now() + WAIT_MS,
    });

    const checked =
      outcome.kind === "part" && outcome.answer?.action === "save"
        ? await saveInput["~standard"].validate(outcome.answer.input)
        : undefined;

    const deadline = outcome.kind === "deadline" ? await stopWaiting(part, invocation.head) : null;

    const file =
      deadline?.kind === "saved" && deadline.head === null
        ? deadline
        : checked !== undefined && checked.issues === undefined
          ? checked.value
          : null;

    return {
      content: [
        {
          kind: "text",
          text:
            file !== null
              ? describeSaved(args.name, file.path, file.expiresAt)
              : deadline?.kind === "open"
                ? "No answer yet. Don't ask for the secret in chat. The request stays open; if the user saves it, a message with the file's path arrives."
                : "The user declined. Don't ask for it in chat or another way; say what's blocked and go on without it.",
        },
      ],
      parts: [part.id],
    };
  },
};

async function stopWaiting(part: Part<typeof secret>, head: HeadName): Promise<SecretPhase> {
  let phase: SecretPhase = { kind: "open", head };

  await part.update((current) => {
    phase = current.phase.kind === "asking" ? { kind: "open", head } : current.phase;

    return { ...current, phase };
  });

  return phase;
}

const save: Command<"core"> = {
  name: SAVE_SECRET_COMMAND,
  title: "Save a requested secret",
  description: "Saves the value for an open secret request to a private file.",
  hidden: true,
  async run(text, { api }) {
    const input = await parseSaveRequest(text);
    const view = await api.session.view();
    const found = view.parts.find((part) => part.id === input.part);

    const current =
      found?.partKind === secret.kind && found.status.kind === "live" ? readSecret(found) : null;

    if (current === null || (current.phase.kind !== "asking" && current.phase.kind !== "open"))
      throw new SdkError("invalid", "This request is no longer waiting.");

    const directory = crypto.randomUUID().replaceAll("-", "");
    const expiresAt = input.days === null ? null : Date.now() + input.days * DAY_MS;
    const folder = await findFolder(api, (await api.session.info()).workspace);
    const home = await writeSecretFile(api.env, directory, current.name, input.value);
    const path = `${home}/.nyte/secrets/${directory}/${current.name}`;

    await changeSaved(api, (entries) => ({
      ...entries,
      [directory]: { name: current.name, folder, path, expiresAt },
    }));

    const outcome = await api.session.part(input.part).act("save", { path, expiresAt });

    if (outcome.kind === "rejected") throw new SdkError("invalid", outcome.reason);

    if (outcome.kind !== "ok")
      throw new Error(`The request could not take the secret: ${outcome.kind}.`);

    return path;
  },
};

async function parseSaveRequest(text: string): Promise<SaveRequest> {
  const checked = await saveRequest["~standard"].validate(JSON.parse(text));

  if (checked.issues !== undefined)
    throw new SdkError("invalid", "The secret request is malformed.");

  return checked.value;
}

async function writeSecretFile(
  env: ExecutionEnv,
  directory: string,
  name: string,
  value: string,
): Promise<string> {
  const job = await env.exec(["sh", "-c", WRITE_FILE, "sh", directory, name], {
    env: { NYTE_SECRET_VALUE: value },
  });

  const decoder = new TextDecoder();
  let output = "";

  for await (const frame of job.output()) {
    if (frame.kind === "bytes") output += decoder.decode(frame.data, { stream: true });
  }

  const end = await job.settled();

  if (end.kind !== "exited" || end.code !== 0 || !output.startsWith("/"))
    throw new Error(`Couldn't write the secret file: ${output.trim() || "the shell failed"}.`);

  return output;
}

const remove: Command<"core"> = {
  name: REMOVE_SECRET_COMMAND,
  title: "Remove a saved secret",
  description: "Deletes a secret file an agent asked for.",
  hidden: true,
  async run(text, { api }) {
    if (!new RegExp(SECRET_DIRECTORY).test(text))
      throw new SdkError("invalid", "That isn't a saved secret.");

    await removeSaved(api, [text]);
  },
};

async function findFolder(api: PluginApi<"core">, workspace: WorkspaceId): Promise<WorkspaceId> {
  const info = await api.sdk.workspace(workspace).info();

  return info.isolation?.source ?? info.id;
}

async function readSaved(api: PluginApi<"core">): Promise<SavedSecrets> {
  const checked = await savedSecrets["~standard"].validate(
    await api.contribute.settings.value(SAVED_SECRETS),
  );

  return checked.issues === undefined ? checked.value : {};
}

async function changeSaved(
  api: PluginApi<"core">,
  change: (entries: SavedSecrets) => SavedSecrets,
): Promise<void> {
  const outcome = await api.sdk.settings.apply(SAVED_SECRETS, change(await readSaved(api)));

  if (outcome.kind !== "applied") throw new Error("The list of saved secrets couldn't be updated.");
}

async function removeSaved(api: PluginApi<"core">, directories: readonly string[]): Promise<void> {
  const job = await api.env.exec(["sh", "-c", REMOVE_DIRECTORIES, "sh", ...directories]);
  const end = await job.settled();

  if (end.kind !== "exited" || end.code !== 0) throw new Error("Couldn't delete the secret file.");

  await changeSaved(api, (entries) =>
    Object.fromEntries(Object.entries(entries).filter((entry) => !directories.includes(entry[0]))),
  );
}

async function sweep(api: PluginApi<"core">): Promise<void> {
  const entries = Object.entries(await readSaved(api));
  const now = Date.now();

  if (!entries.some((entry) => entry[1].expiresAt !== null && entry[1].expiresAt <= now)) return;
  const folder = await findFolder(api, (await api.session.info()).workspace);

  const expired = entries
    .filter(
      (entry) =>
        entry[1].folder === folder && entry[1].expiresAt !== null && entry[1].expiresAt <= now,
    )
    .map((entry) => entry[0]);

  if (expired.length > 0) await removeSaved(api, expired);
}

/** @category plugins */
export default {
  id: "secrets",
  contribute: { parts: [secret], tools: [request], commands: [save, remove], settings: [saved] },
  activate(api) {
    const run = (): void => void sweep(api).catch(() => undefined);
    const timer = setInterval(run, SWEEP_MS);

    api.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    run();
  },
} satisfies Plugin;
