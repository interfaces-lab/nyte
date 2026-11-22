import type { LanguagePosition } from "@nyte-ai/core";
import { isJson } from "@nyte-ai/schema";
import type {
  DocumentLink,
  DocumentLinkToken,
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
import { findProvider } from "./capabilities.ts";
import { readDocumentLink, readDocumentLinks } from "./lsp-structure.ts";
import { LspError } from "./rpc.ts";
import { ask, findProviders } from "./route.ts";
import type { Run, Servers } from "./state.ts";

const DETAIL_ROWS = 24;

const DETAIL_BUDGET_MS = 300;

export async function completion(
  servers: Servers,
  input: LanguagePosition & { readonly trigger: CompletionTrigger },
): Promise<CompletionList> {
  const empty: CompletionList = { items: [], incomplete: false };
  const aborted = servers.claimCompletion();
  const completers = await findProviders(servers, input.path, "completion");
  const trigger = input.trigger;

  const context: Json =
    trigger.kind === "character"
      ? { triggerKind: 2, triggerCharacter: trigger.character }
      : { triggerKind: trigger.kind === "invoked" ? 1 : 3 };

  const lists = await Promise.all(
    completers.map(async (asked): Promise<CompletionList> => {
      const target = asked.target;

      const answer = aborted.aborted
        ? undefined
        : await target.run.rpc
            .request(
              "textDocument/completion",
              {
                textDocument: { uri: asked.uri },
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
      target.slot.answers += 1;
      const number = target.slot.answers;

      target.slot.completion = {
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
                resolve: { kind: "completion", server: target.run.id, answer: number, item: index },
              },
            ];
      });

      if (asked.provider.resolveProvider === true) {
        await resolveDetails(target.run, items, read.items, read.defaults);
      }

      return { items, incomplete: read.incomplete };
    }),
  );

  return aborted.aborted
    ? empty
    : {
        items: lists.flatMap((list) => list.items),
        incomplete: lists.some((list) => list.incomplete),
      };
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

  if (findProvider(found.run, "completion", null)?.resolveProvider !== true) {
    return { ...original, resolve: token };
  }

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
  const offered = await Promise.all(
    (await findProviders(servers, input.path, "codeActions")).map(async (asked) => {
      const target = asked.target;

      const overlapping = servers.reported(target.slot, asked.document.path).filter((raw) => {
        const range = readDiagnostics([raw], servers.place)[0]?.range;

        return (
          range !== undefined &&
          comparePositions(range.start, input.range.end) <= 0 &&
          comparePositions(input.range.start, range.end) <= 0
        );
      });

      const asking = await ask(servers, target, "textDocument/codeAction", {
        textDocument: { uri: asked.uri },
        range: toLspRange(input.range),
        context: {
          diagnostics: overlapping,
          triggerKind: 1,
          ...(input.only === undefined ? {} : { only: [...input.only] }),
        },
      });

      const plans = asking instanceof LspError ? [] : readCodeActions(asking.answer);
      target.slot.answers += 1;
      const number = target.slot.answers;
      target.slot.actions = { answer: number, plans };

      return plans.map((plan, index): CodeAction => ({
        title: plan.title,
        kind: plan.kind,
        preferred: plan.preferred,
        disabled: plan.disabled,
        token: { kind: "codeAction", server: target.run.id, answer: number, item: index },
      }));
    }),
  );

  return offered.flat();
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
    plan.resolvable &&
    findProvider(run, "codeActions", null)?.resolveProvider === true &&
    isJson(raw)
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

export async function documentLinks(
  servers: Servers,
  input: { readonly path: string },
): Promise<readonly DocumentLink[]> {
  const found = await Promise.all(
    (await findProviders(servers, input.path, "documentLinks")).map(async (asked) => {
      const target = asked.target;

      const asking = await ask(servers, target, "textDocument/documentLink", {
        textDocument: { uri: asked.uri },
      });

      const links =
        asking instanceof LspError ? [] : readDocumentLinks(asking.answer, servers.place);
      const resolves = asked.provider.resolveProvider === true;
      target.slot.answers += 1;
      const number = target.slot.answers;
      target.slot.links.set(asked.uri, { answer: number, items: links.map((read) => read.raw) });

      return links.map((read, index): DocumentLink => ({
        ...read.link,
        token:
          read.link.target === null && resolves
            ? { kind: "documentLink", server: target.run.id, answer: number, item: index }
            : null,
      }));
    }),
  );

  return found
    .flat()
    .toSorted((left, right) => comparePositions(left.range.start, right.range.start));
}

export async function resolveDocumentLink(
  servers: Servers,
  input: { readonly token: DocumentLinkToken },
): Promise<DocumentLink | null> {
  const token = input.token;
  const found = servers.findRun(token.server);
  const held = [...(found?.slot.links.values() ?? [])].find(
    (links) => links.answer === token.answer,
  );
  const raw = held?.items[token.item];

  if (found === null || raw === undefined) return null;

  servers.touch(found.slot);
  const asking = await ask(servers, found, "documentLink/resolve", raw);
  const read = asking instanceof LspError ? null : readDocumentLink(asking.answer, servers.place);

  return read === null ? null : { ...read.link, token: null };
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
