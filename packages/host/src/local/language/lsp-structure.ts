import { compile, isJson, isJsonObject } from "@nyte-ai/schema";
import type {
  DocumentHighlight,
  FoldingRange,
  HierarchyItem,
  Json,
  JsonSchema,
  SemanticTokens,
  TextRange,
  WorkspaceSymbol,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { comparePositions, RangeType, readRange, SYMBOL_KINDS } from "./lsp.ts";
import type { Place } from "./lsp.ts";

const HIGHLIGHT_KINDS = ["text", "read", "write"] as const;

const FOLDING_KINDS = ["comment", "imports", "region"] as const;

const Highlights = compile(
  Type.Array(Type.Object({ range: RangeType, kind: Type.Optional(Type.Number()) })),
);

const WorkspaceSymbols = compile(
  Type.Array(
    Type.Object({
      name: Type.String(),
      kind: Type.Number(),
      tags: Type.Optional(Type.Array(Type.Number())),
      deprecated: Type.Optional(Type.Boolean()),
      containerName: Type.Optional(Type.String()),
      location: Type.Object({ uri: Type.String(), range: Type.Optional(RangeType) }),
    }),
  ),
);

const FoldingRanges = compile(
  Type.Array(
    Type.Object({
      startLine: Type.Number(),
      endLine: Type.Number(),
      kind: Type.Optional(Type.String()),
    }),
  ),
);

const SelectionRangeType = Type.Object({ range: RangeType, parent: Type.Optional(Type.Unknown()) });

const SelectionRange = compile(SelectionRangeType);

const SelectionRanges = compile(Type.Array(SelectionRangeType));

const Tokens = compile(Type.Object({ data: Type.Array(Type.Number()) }));

const Legend = compile(
  Type.Object({
    legend: Type.Object({
      tokenTypes: Type.Array(Type.String()),
      tokenModifiers: Type.Array(Type.String()),
    }),
  }),
);

const HierarchyItemLspType = Type.Object({
  name: Type.String(),
  kind: Type.Number(),
  tags: Type.Optional(Type.Array(Type.Number())),
  detail: Type.Optional(Type.String()),
  uri: Type.String(),
  range: RangeType,
  selectionRange: RangeType,
});

const HierarchyItemLsp = compile(HierarchyItemLspType);

const Calls = compile(
  Type.Array(
    Type.Object({
      from: Type.Optional(Type.Unknown()),
      to: Type.Optional(Type.Unknown()),
      fromRanges: Type.Array(RangeType),
    }),
  ),
);

const Items = compile(Type.Array(Type.Unknown()));

export interface ReadHierarchyItem {
  readonly item: Omit<HierarchyItem, "token">;
  readonly raw: Json;
}

export function readHighlights(value: unknown): readonly DocumentHighlight[] | null {
  return Highlights.Check(value)
    ? value.map((entry) => ({
        range: readRange(entry.range),
        kind: HIGHLIGHT_KINDS[(entry.kind ?? 1) - 1] ?? "text",
      }))
    : null;
}

export function readWorkspaceSymbols(value: unknown, place: Place): readonly WorkspaceSymbol[] {
  if (!WorkspaceSymbols.Check(value)) return [];

  return value.flatMap((entry) => {
    const path = place(entry.location.uri);
    const range = entry.location.range;

    return path === null || range === undefined
      ? []
      : [
          {
            name: entry.name,
            kind: SYMBOL_KINDS[entry.kind - 1] ?? "variable",
            container: entry.containerName ?? "",
            location: { path, range: readRange(range) },
            deprecated: entry.deprecated ?? (entry.tags ?? []).includes(1),
          },
        ];
  });
}

export function readFoldingRanges(value: unknown): readonly FoldingRange[] {
  if (!FoldingRanges.Check(value)) return [];

  return value.map((entry) => ({
    startLine: entry.startLine,
    endLine: entry.endLine,
    kind: FOLDING_KINDS.find((kind) => kind === entry.kind) ?? null,
  }));
}

export function readSelectionRanges(value: unknown): readonly (readonly TextRange[])[] {
  return SelectionRanges.Check(value) ? value.map((entry) => unnest(entry)) : [];
}

function unnest(entry: Static<typeof SelectionRangeType>): readonly TextRange[] {
  const range = readRange(entry.range);

  return SelectionRange.Check(entry.parent) ? [range, ...unnest(entry.parent)] : [range];
}

export function nestRanges(ranges: readonly TextRange[]): readonly TextRange[] {
  return ranges
    .toSorted(
      (left, right) =>
        comparePositions(right.start, left.start) || comparePositions(left.end, right.end),
    )
    .reduce<TextRange[]>((kept, range) => {
      const last = kept.at(-1);

      const holds =
        last === undefined ||
        (comparePositions(range.start, last.start) <= 0 &&
          comparePositions(last.end, range.end) <= 0 &&
          (comparePositions(range.start, last.start) < 0 ||
            comparePositions(last.end, range.end) < 0));

      if (holds) kept.push(range);

      return kept;
    }, []);
}

export function readSemanticTokens(value: unknown, provider: JsonSchema): SemanticTokens | null {
  return Tokens.Check(value) && Legend.Check(provider)
    ? {
        types: provider.legend.tokenTypes,
        modifiers: provider.legend.tokenModifiers,
        data: value.data,
      }
    : null;
}

export function readHierarchyItems(value: unknown, place: Place): readonly ReadHierarchyItem[] {
  return Items.Check(value) ? value.flatMap((entry) => readHierarchyItem(entry, place) ?? []) : [];
}

export function readHierarchyCalls(
  value: unknown,
  side: "from" | "to",
  place: Place,
): readonly (ReadHierarchyItem & { readonly ranges: readonly TextRange[] })[] {
  if (!Calls.Check(value)) return [];

  return value.flatMap((entry) => {
    const read = readHierarchyItem(entry[side], place);

    return read === null ? [] : [{ ...read, ranges: entry.fromRanges.map(readRange) }];
  });
}

function readHierarchyItem(value: unknown, place: Place): ReadHierarchyItem | null {
  if (!HierarchyItemLsp.Check(value) || !isJson(value) || !isJsonObject(value)) return null;
  const path = place(value.uri);

  return path === null
    ? null
    : {
        raw: value,
        item: {
          name: value.name,
          detail: value.detail ?? "",
          kind: SYMBOL_KINDS[value.kind - 1] ?? "variable",
          location: { path, range: readRange(value.range) },
          selection: readRange(value.selectionRange),
          deprecated: (value.tags ?? []).includes(1),
        },
      };
}
