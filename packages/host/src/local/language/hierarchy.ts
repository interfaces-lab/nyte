import type { LanguageApi, LanguagePosition } from "@nyte-ai/core";
import type { HierarchyItem, HierarchyToken, Json } from "@nyte-ai/schema";
import { readHierarchyCalls, readHierarchyItems } from "./lsp-structure.ts";
import type { ReadHierarchyItem } from "./lsp-structure.ts";
import { toLspPosition } from "./lsp.ts";
import { LspError } from "./rpc.ts";
import { ask, findProviders } from "./route.ts";
import type { HeldItems, Servers, Target } from "./state.ts";

type Kind = HierarchyToken["kind"];

const PREPARE = {
  callHierarchy: "textDocument/prepareCallHierarchy",
  typeHierarchy: "textDocument/prepareTypeHierarchy",
} as const satisfies Record<Kind, string>;

export function languageHierarchies(
  servers: Servers,
): Pick<
  LanguageApi,
  "callHierarchy" | "incomingCalls" | "outgoingCalls" | "typeHierarchy" | "supertypes" | "subtypes"
> {
  const mint = (
    target: Target,
    held: HeldItems,
    kind: Kind,
    read: ReadHierarchyItem,
  ): HierarchyItem => ({
    ...read.item,
    token: {
      kind,
      server: target.run.id,
      answer: held.answer,
      item: held.items.push(read.raw) - 1,
    },
  });

  const prepare = async (
    kind: Kind,
    input: LanguagePosition,
  ): Promise<readonly HierarchyItem[]> => {
    for (const asked of await findProviders(servers, input.path, kind)) {
      const asking = await ask(servers, asked.target, PREPARE[kind], {
        textDocument: { uri: asked.uri },
        position: toLspPosition(input.position),
      });

      const roots =
        asking instanceof LspError ? [] : readHierarchyItems(asking.answer, servers.place);

      if (roots.length === 0) continue;
      const slot = asked.target.slot;
      slot.answers += 1;
      const held: HeldItems = { answer: slot.answers, items: [] };
      slot.hierarchies[kind] = held;

      return roots.map((root) => mint(asked.target, held, kind, root));
    }

    return [];
  };

  const follow = async <T>(
    kind: Kind,
    token: HierarchyToken,
    method: string,
    read: (answer: unknown, target: Target, held: HeldItems) => readonly T[],
  ): Promise<readonly T[]> => {
    const target = servers.findRun(token.server);
    const held = target?.slot.hierarchies[kind] ?? null;
    const item: Json | undefined = held?.items[token.item];

    if (
      target === null ||
      held === null ||
      item === undefined ||
      token.kind !== kind ||
      held.answer !== token.answer
    ) {
      return [];
    }

    servers.touch(target.slot);
    const asking = await ask(servers, target, method, { item });

    return asking instanceof LspError ? [] : read(asking.answer, target, held);
  };

  const calls = (token: HierarchyToken, method: string, side: "from" | "to") =>
    follow("callHierarchy", token, method, (answer, target, held) =>
      readHierarchyCalls(answer, side, servers.place).map((call) => ({
        item: mint(target, held, "callHierarchy", call),
        ranges: [...call.ranges],
      })),
    );

  const types = (token: HierarchyToken, method: string) =>
    follow("typeHierarchy", token, method, (answer, target, held) =>
      readHierarchyItems(answer, servers.place).map((read) =>
        mint(target, held, "typeHierarchy", read),
      ),
    );

  return {
    callHierarchy: (input) => prepare("callHierarchy", input),
    incomingCalls: (input) => calls(input.token, "callHierarchy/incomingCalls", "from"),
    outgoingCalls: (input) => calls(input.token, "callHierarchy/outgoingCalls", "to"),
    typeHierarchy: (input) => prepare("typeHierarchy", input),
    supertypes: (input) => types(input.token, "typeHierarchy/supertypes"),
    subtypes: (input) => types(input.token, "typeHierarchy/subtypes"),
  };
}
