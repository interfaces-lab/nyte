import type { LanguagePosition } from "@nyte-ai/core";
import { isJson } from "@nyte-ai/schema";
import type {
  Json,
  CodeAction,
  CodeActionKind,
  CodeActionOutcome,
  CodeActionResolveToken,
  CompletionItem,
  CompletionList,
  CompletionResolveToken,
  CompletionTrigger,
  TextRange,
  WorkspaceEdit,
} from "@nyte-ai/schema";
import {
  comparePositions,
  readCodeAction,
  readCodeActions,
  readCommand,
  readCompletionAnswer,
  readCompletionItem,
  readDiagnostics,
  readWorkspaceEdit,
  toLspPosition,
  toLspRange,
} from "./lsp.ts";
import { LspError } from "./rpc.ts";
import type { Run, Servers } from "./state.ts";

const DETAIL_ROWS = 24;

const DETAIL_BUDGET_MS = 300;

/** Lists completions; a newer completion anywhere in the workspace cancels this one, which then answers empty. Callable rows without parameters get them from a resolve, as many as answer within a short budget. */
export async function completion(
  servers: Servers,
  input: LanguagePosition & { readonly trigger: CompletionTrigger },
): Promise<CompletionList> {
  const empty: CompletionList = { items: [], incomplete: false };
  const aborted = servers.claimCompletion();
  const synced = await servers.sync(input.path);

  if (synced === null || aborted.aborted) return empty;
  const slot = synced.slot;
  const trigger = input.trigger;

  const context: Json =
    trigger.kind === "character"
      ? { triggerKind: 2, triggerCharacter: trigger.character }
      : { triggerKind: trigger.kind === "invoked" ? 1 : 3 };

  const answer = await synced.run.rpc
    .request(
      "textDocument/completion",
      {
        textDocument: { uri: servers.uri(synced.document.path) },
        position: toLspPosition(input.position),
        context,
      },
      aborted,
    )
    .catch((error: unknown) => {
      if (error instanceof LspError) return undefined;
      throw error;
    });

  if (answer === undefined || aborted.aborted) return empty;
  const read = readCompletionAnswer(answer);
  slot.answers += 1;
  const number = slot.answers;

  slot.completion = {
    run: synced.run.id,
    answer: number,
    items: read.items,
    defaults: read.defaults,
  };

  const items = read.items.flatMap((raw, index): CompletionItem[] => {
    const item = readCompletionItem(raw, read.defaults);

    return item === null
      ? []
      : [
          {
            ...item,
            resolve: { kind: "completion", server: synced.run.id, answer: number, item: index },
          },
        ];
  });

  if (synced.run.capabilities.resolvesCompletion) {
    await resolveDetails(synced.run, items, read.items, read.defaults);
  }

  return { items, incomplete: read.incomplete };
}

export async function resolveCompletion(
  servers: Servers,
  input: { readonly token: CompletionResolveToken },
): Promise<CompletionItem | null> {
  const token = input.token;
  const found = servers.findRun(token.server);
  const answer = found?.slot.completion;

  if (found === null || answer === null || answer === undefined || answer.answer !== token.answer) {
    return null;
  }
  const raw = answer.items[token.item];
  const original = readCompletionItem(raw, answer.defaults);

  if (!isJson(raw) || original === null) return null;

  if (!found.run.capabilities.resolvesCompletion) return { ...original, resolve: token };
  servers.touch(found.slot);

  const resolved = await found.run.rpc
    .request("completionItem/resolve", raw)
    .then((value) => readCompletionItem(value, answer.defaults))
    .catch(() => null);

  if (resolved === null) return { ...original, resolve: token };

  return {
    ...resolved,
    insert: { ...resolved.insert, replace: resolved.insert.replace ?? original.insert.replace },
    resolve: token,
  };
}

export async function codeActions(
  servers: Servers,
  input: {
    readonly path: string;
    readonly range: TextRange;
    readonly only?: readonly CodeActionKind[];
  },
): Promise<readonly CodeAction[]> {
  const synced = await servers.sync(input.path);

  if (synced === null) return [];

  const overlapping = servers.published(synced.document.path).filter((raw) => {
    const range = readDiagnostics([raw], servers.place)[0]?.range;

    return (
      range !== undefined &&
      comparePositions(range.start, input.range.end) <= 0 &&
      comparePositions(input.range.start, range.end) <= 0
    );
  });

  const answer = await synced.run.rpc
    .request("textDocument/codeAction", {
      textDocument: { uri: servers.uri(synced.document.path) },
      range: toLspRange(input.range),
      context: {
        diagnostics: overlapping,
        triggerKind: 1,
        ...(input.only === undefined ? {} : { only: [...input.only] }),
      },
    })
    .catch((error: unknown) => {
      if (error instanceof LspError) return null;
      throw error;
    });

  const plans = readCodeActions(answer);
  synced.slot.answers += 1;
  const number = synced.slot.answers;
  synced.slot.actions = { run: synced.run.id, answer: number, plans };

  return plans.map((plan, index) => ({
    title: plan.title,
    kind: plan.kind,
    preferred: plan.preferred,
    disabled: plan.disabled,
    token: { kind: "codeAction", server: synced.run.id, answer: number, item: index },
  }));
}

export async function resolveCodeAction(
  servers: Servers,
  input: { readonly token: CodeActionResolveToken },
): Promise<CodeActionOutcome> {
  const token = input.token;
  const found = servers.findRun(token.server);

  const plan =
    found?.slot.actions?.answer === token.answer ? found.slot.actions.plans[token.item] : undefined;

  if (found === null || plan === undefined) return { kind: "stale" };

  if (plan.disabled !== null) return { kind: "refused", reason: plan.disabled };
  servers.touch(found.slot);
  const run = found.run;
  const raw = plan.raw;

  const action =
    plan.resolvable && run.capabilities.resolvesCodeAction && isJson(raw)
      ? ((await run.rpc
          .request("codeAction/resolve", raw)
          .then(readCodeAction)
          .catch(() => null)) ?? plan)
      : plan;

  const direct = action.edit === undefined ? null : readWorkspaceEdit(action.edit, servers.place);

  if (direct?.kind === "refused") return direct;
  const command = readCommand(action.command);

  if (command === null) return { kind: "edit", edit: direct?.edit ?? { files: [] } };
  const collected: WorkspaceEdit[] = direct === null ? [] : [direct.edit];
  run.collecting = collected;

  const failure = await run.rpc
    .request("workspace/executeCommand", {
      command: command.command,
      arguments: (command.arguments ?? []).filter(isJson),
    })
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      run.collecting = null;
    });

  if (failure !== null) return { kind: "refused", reason: failure };

  return { kind: "edit", edit: { files: collected.flatMap((edit) => edit.files) } };
}

async function resolveDetails(
  run: Run,
  items: CompletionItem[],
  raw: readonly unknown[],
  defaults: Parameters<typeof readCompletionItem>[1],
): Promise<void> {
  const chosen = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.invocation !== "none" && entry.item.tail === "")
    .toSorted((left, right) =>
      left.item.sort === right.item.sort
        ? left.item.label.localeCompare(right.item.label)
        : left.item.sort.localeCompare(right.item.sort),
    )
    .slice(0, DETAIL_ROWS);

  const budget = AbortSignal.timeout(DETAIL_BUDGET_MS);

  await Promise.all(
    chosen.map(async (entry) => {
      const item = raw[entry.item.resolve?.item ?? -1];

      if (!isJson(item)) return;

      const resolved = await run.rpc
        .request("completionItem/resolve", item, budget)
        .then((value) => readCompletionItem(value, defaults))
        .catch(() => null);

      if (resolved === null) return;
      items[entry.index] = {
        ...entry.item,
        tail: resolved.tail,
        type: resolved.type,
        invocation: resolved.invocation,
        documentation:
          entry.item.documentation === "" ? resolved.documentation : entry.item.documentation,
      };
    }),
  );
}
