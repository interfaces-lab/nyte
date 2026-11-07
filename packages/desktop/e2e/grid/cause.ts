import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import type { CauseQuery } from "./check.ts";
import type { Part } from "./geometry.ts";
import type { Declaration, SnapBox, Snapshot } from "./collect.ts";
import type { Expr } from "./rules.ts";

export interface SourceRef {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface TokenLink {
  readonly token: string;
  readonly value: string;
  readonly defined: SourceRef | null;
}

/** Why a value is what it is: the token it reads and where StyleX applies it, or why that's unknown. */
export type Cause =
  | {
      readonly kind: "token";
      readonly token: string;
      readonly handle: string | null;
      readonly chain: readonly TokenLink[];
      readonly declaration: string;
      readonly use: SourceRef | null;
      readonly candidates: number;
    }
  | {
      readonly kind: "literal";
      readonly declaration: string;
      readonly use: SourceRef | null;
      readonly candidates: number;
    }
  /** Every length on the way is a rail term, but this one is absent; `at` is where the innermost length is set. */
  | { readonly kind: "missing"; readonly term: string; readonly at: SourceRef | null }
  | { readonly kind: "unresolved"; readonly reason: string };

interface StyleUse {
  readonly property: string;
  readonly css: string;
  readonly at: SourceRef;
  /** Every property of the same style key, with its CSS, to tell apart sites that share one value. */
  readonly block: ReadonlyMap<string, readonly string[]>;
}

export interface SourceIndex {
  readonly handles: ReadonlyMap<string, string>;
  readonly tokens: ReadonlyMap<string, TokenLink>;
  readonly uses: ReadonlyMap<string, readonly StyleUse[]>;
}

const REPO = resolve(import.meta.dirname, "../../../..");

const SOURCE_ROOTS = ["packages/ui/src", "packages/app/src"];

const UNITLESS = new Set([
  "lineHeight",
  "flex",
  "flexGrow",
  "flexShrink",
  "opacity",
  "zIndex",
  "fontWeight",
  "order",
]);

/** Whitespace-free, as both StyleX's output and the CSSOM's serialisation reduce to the same text. */
export const normalize = (css: string): string =>
  css
    .replace(/\s+/gu, "")
    .replace(/(^|[^\d.])0px/gu, "$10")
    .toLowerCase();

const camel = (property: string): string =>
  property.startsWith("--")
    ? property
    : property.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());

export async function buildSourceIndex(): Promise<SourceIndex> {
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map(async (root) =>
        (await readdir(join(REPO, root), { recursive: true, withFileTypes: true }))
          .filter(
            (entry) =>
              entry.isFile() &&
              /\.tsx?$/u.test(entry.name) &&
              !/\.(test|browser-test)\./u.test(entry.name),
          )
          .map((entry) => join(entry.parentPath, entry.name)),
      ),
    )
  )
    .flat()
    .sort();

  const parsed = (
    await Promise.all(
      files.map(async (path) => {
        const text = await readFile(path, "utf8");

        return /\b(?:create|defineVars|defineConsts)\(/u.test(text)
          ? [
              {
                path: relative(REPO, path),
                source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
              },
            ]
          : [];
      }),
    )
  ).flat();

  const handles = new Map<string, string>();
  const tokens = new Map<string, TokenLink>();

  for (const file of parsed) {
    visitCalls(file.source, (call, name, binding) => {
      const argument = call.arguments[0];

      if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return;

      for (const property of argument.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = propertyName(property.name);
        const value = defaultString(property.initializer);

        if (key === null || value === null) continue;

        if (name === "defineConsts" && binding !== null) handles.set(`${binding}.${key}`, value);

        if (name === "defineVars" && key.startsWith("--"))
          tokens.set(key, { token: key, value, defined: refAt(file, property) });
      }
    });
  }

  const uses = new Map<string, StyleUse[]>();

  for (const file of parsed) {
    visitCalls(file.source, (call, name) => {
      const argument = call.arguments[0];

      if (name !== "create" || argument === undefined || !ts.isObjectLiteralExpression(argument))
        return;

      for (const style of argument.properties) {
        if (!ts.isPropertyAssignment(style) || !ts.isObjectLiteralExpression(style.initializer))
          continue;

        const entries = style.initializer.properties.flatMap((property) => {
          if (!ts.isPropertyAssignment(property)) return [];
          const key = propertyName(property.name);

          return key === null
            ? []
            : cssValues(property.initializer, key, handles).map((css) => ({
                key,
                css,
                node: property,
              }));
        });

        const block = new Map<string, string[]>();

        for (const entry of entries)
          block.set(entry.key, [...(block.get(entry.key) ?? []), entry.css]);

        for (const entry of entries) {
          const list = uses.get(entry.css) ?? [];
          list.push({ property: entry.key, css: entry.css, at: refAt(file, entry.node), block });
          uses.set(entry.css, list);
        }
      }
    });
  }

  return { handles, tokens, uses };
}

/** The calc() a rail or pitch expression compiles to; an unknown handle fails the run. */
export function compileExpr(index: SourceIndex, expr: Expr): string {
  const inner = (part: Expr): string => {
    switch (part.op) {
      case "handle": {
        const css = index.handles.get(part.handle);

        if (css === undefined)
          throw new Error(`The grid rules name an unknown StyleX handle: ${part.handle}.`);

        return css;
      }

      case "px":
        return `${String(part.px)}px`;
      case "sum":
        return part.terms.map(inner).join(" + ");
      case "diff":
        return `(${inner(part.left)}) - (${inner(part.right)})`;
      case "half":
        return `(${inner(part.of)}) / 2`;
      default: {
        const exhaustive: never = part;

        return exhaustive;
      }
    }
  };

  return `calc(${inner(expr)})`;
}

/** The declarations that can set a longhand, most specific first. */
export const LONGHANDS = new Map(
  Object.entries({
    "padding-top": ["padding-top", "padding-block-start", "padding-block", "padding"],
    "padding-bottom": ["padding-bottom", "padding-block-end", "padding-block", "padding"],
    "padding-left": ["padding-left", "padding-inline-start", "padding-inline", "padding"],
    "padding-right": ["padding-right", "padding-inline-end", "padding-inline", "padding"],
    "margin-top": ["margin-top", "margin-block-start", "margin-block", "margin"],
    "margin-bottom": ["margin-bottom", "margin-block-end", "margin-block", "margin"],
    "margin-left": ["margin-left", "margin-inline-start", "margin-inline", "margin"],
    "margin-right": ["margin-right", "margin-inline-end", "margin-inline", "margin"],
    "row-gap": ["row-gap", "gap"],
    "column-gap": ["column-gap", "gap"],
    top: ["top", "inset-block-start", "inset-block", "inset"],
    bottom: ["bottom", "inset-block-end", "inset-block", "inset"],
    left: ["left", "inset-inline-start", "inset-inline", "inset"],
    right: ["right", "inset-inline-end", "inset-inline", "inset"],
    width: ["width", "inline-size", "min-width", "flex-basis", "flex"],
    height: ["height", "block-size", "min-height"],
    "min-height": ["min-height"],
    "border-top-width": [
      "border-top-width",
      "border-block-start-width",
      "border-block-width",
      "border-width",
    ],
    "border-bottom-width": [
      "border-bottom-width",
      "border-block-end-width",
      "border-block-width",
      "border-width",
    ],
    "border-left-width": [
      "border-left-width",
      "border-inline-start-width",
      "border-inline-width",
      "border-width",
    ],
    "border-right-width": [
      "border-right-width",
      "border-inline-end-width",
      "border-inline-width",
      "border-width",
    ],
    "border-top-left-radius": [
      "border-top-left-radius",
      "border-start-start-radius",
      "border-radius",
    ],
    "border-top-right-radius": [
      "border-top-right-radius",
      "border-start-end-radius",
      "border-radius",
    ],
    "border-bottom-right-radius": [
      "border-bottom-right-radius",
      "border-end-end-radius",
      "border-radius",
    ],
    "border-bottom-left-radius": [
      "border-bottom-left-radius",
      "border-end-start-radius",
      "border-radius",
    ],
    "font-size": ["font-size", "font"],
    "line-height": ["line-height", "font"],
  }),
);

/** StyleX writes block-axis logical properties as physical ones, since they don't depend on direction. */
const BLOCK_ALIASES = new Map(
  Object.entries({
    "padding-top": ["paddingBlockStart"],
    "padding-bottom": ["paddingBlockEnd"],
    "margin-top": ["marginBlockStart"],
    "margin-bottom": ["marginBlockEnd"],
    top: ["insetBlockStart"],
    bottom: ["insetBlockEnd"],
    height: ["blockSize"],
    "min-height": ["minBlockSize"],
    "max-height": ["maxBlockSize"],
  }),
);

const INHERITED = new Set(["font-size", "line-height"]);

/** Resolves what a finding asks about into a cause with a token and a source line. */
export function resolveCause(index: SourceIndex, snapshot: Snapshot, query: CauseQuery): Cause {
  switch (query.kind) {
    case "none":
      return { kind: "unresolved", reason: query.reason };
    case "property":
      return propertyCause(index, snapshot, query.box, query.property);
    case "offset":
      return offsetCause(index, snapshot, query.parts, query.terms);
    case "sum":
      return sumCause(index, snapshot, query.parts, query.grid);
    default: {
      const exhaustive: never = query;

      return exhaustive;
    }
  }
}

/** Follows private variables such as --_row-padding-inline up to the rule that gives them a value. */
function propertyCause(
  index: SourceIndex,
  snapshot: Snapshot,
  id: number,
  property: string,
): Cause {
  const found = findDeclaration(snapshot, id, property);

  if (found === null)
    return {
      kind: "unresolved",
      reason: INHERITED.has(property)
        ? "inherited from the document"
        : "no rule sets it: a browser default or layout",
    };

  let value = found.declaration.value;
  let use = findUse(index, found.box, found.declaration);
  const hops = new Set<string>();

  for (
    let match = /var\((--_[\w-]+)/u.exec(value);
    match !== null;
    match = /var\((--_[\w-]+)/u.exec(value)
  ) {
    const name = match[1] ?? "";

    if (hops.has(name)) break;
    hops.add(name);
    const owner = findCustom(snapshot, found.box.id, name);

    if (owner === null) break;
    value = value.replace(`var(${name})`, owner.declaration.value);
    use = findUse(index, owner.box, owner.declaration) ?? use;
  }

  const token = /var\((--nyte-[\w-]+)/u.exec(value)?.[1];
  const declaration = `${found.declaration.property}: ${found.declaration.value}`;

  if (token === undefined)
    return { kind: "literal", declaration, use: use?.at ?? null, candidates: use?.candidates ?? 0 };

  return {
    kind: "token",
    token,
    handle: handleFor(index, value),
    chain: tokenChain(index, token),
    declaration,
    use: use?.at ?? null,
    candidates: use?.candidates ?? 0,
  };
}

/**
 * The innermost length on the way to an edge that isn't one of the rail's own terms. A hairline
 * border is the frame, not a step, so the padding inside it is what moves the content.
 */
function offsetCause(
  index: SourceIndex,
  snapshot: Snapshot,
  parts: readonly Part[],
  terms: readonly string[],
): Cause {
  const termTokens = new Set(
    terms.flatMap((term) => /var\((--nyte-[\w-]+)/u.exec(index.handles.get(term) ?? "")?.[1] ?? []),
  );

  const declared = parts.flatMap((part) =>
    part.kind === "declared"
      ? [{ part, cause: propertyCause(index, snapshot, part.box, part.property) }]
      : [],
  );

  const outside = declared.find(
    (entry) =>
      !(entry.part.property.startsWith("border-") && entry.part.px === 1) &&
      (entry.cause.kind !== "token" || !termTokens.has(entry.cause.token)),
  );

  if (outside !== undefined && outside.cause.kind !== "unresolved") return outside.cause;
  const layout = parts.find((part) => part.kind === "layout");

  if (layout !== undefined) {
    const box = snapshot.boxes[layout.box];

    return {
      kind: "unresolved",
      reason: `${String(layout.px)}px placed by layout in ${box?.key ?? "an ancestor"}: alignment, centring or content`,
    };
  }

  const seen = new Set(
    declared.flatMap((entry) => (entry.cause.kind === "token" ? [entry.cause.token] : [])),
  );

  const missing = terms.find((term) => {
    const token = /var\((--nyte-[\w-]+)/u.exec(index.handles.get(term) ?? "")?.[1];

    return token !== undefined && !seen.has(token);
  });

  const innermost = declared.find(
    (entry) => entry.cause.kind === "token" || entry.cause.kind === "literal",
  )?.cause;

  const at = innermost?.kind === "token" || innermost?.kind === "literal" ? innermost.use : null;

  if (missing !== undefined) return { kind: "missing", term: missing, at };

  return outside?.cause ?? { kind: "unresolved", reason: "every length on the way is a rail term" };
}

/** The first part off the grid; a 1px border is made up for in the padding, so the padding is where the fix goes. */
function sumCause(
  index: SourceIndex,
  snapshot: Snapshot,
  parts: readonly Part[],
  grid: 1 | 2,
): Cause {
  const off = (part: Part): boolean => !(Number.isInteger(part.px) && part.px % grid === 0);

  const border = (part: Part): boolean =>
    part.kind === "declared" && part.property.startsWith("border-");

  const odd = parts.find((part) => off(part) && !border(part));
  const key = (id: number): string => snapshot.boxes[id]?.key ?? "a box";

  if (odd?.kind === "declared") return propertyCause(index, snapshot, odd.box, odd.property);

  if (odd?.kind === "content")
    return {
      kind: "unresolved",
      reason: `${String(odd.px)}px of content in ${key(odd.box)}: text or children no rule sizes`,
    };

  if (odd?.kind === "layout")
    return {
      kind: "unresolved",
      reason: `${String(odd.px)}px placed by layout in ${key(odd.box)}: alignment or centring`,
    };

  const padding = parts.find(
    (part) => part.kind === "declared" && part.property.startsWith("padding-"),
  );

  if (parts.some((part) => border(part) && off(part)) && padding?.kind === "declared")
    return propertyCause(index, snapshot, padding.box, padding.property);

  return {
    kind: "unresolved",
    reason: "every part is on the grid; the box's own layout makes the difference",
  };
}

function findDeclaration(
  snapshot: Snapshot,
  id: number,
  property: string,
): { box: SnapBox; declaration: Declaration } | null {
  const names = LONGHANDS.get(property) ?? [property];

  for (
    let current: number | null = id;
    current !== null;
    current = snapshot.boxes[current]?.parent ?? null
  ) {
    const box = snapshot.boxes[current];

    if (box === undefined) return null;

    for (const name of names) {
      const declaration = box.declarations.findLast((entry) => entry.property === name);

      if (declaration !== undefined) return { box, declaration };
    }

    if (!INHERITED.has(property)) return null;
  }

  return null;
}

function findCustom(
  snapshot: Snapshot,
  id: number,
  name: string,
): { box: SnapBox; declaration: Declaration } | null {
  for (
    let current: number | null = id;
    current !== null;
    current = snapshot.boxes[current]?.parent ?? null
  ) {
    const box = snapshot.boxes[current];
    const declaration = box?.declarations.findLast((entry) => entry.property === name);

    if (box !== undefined && declaration !== undefined) return { box, declaration };
  }

  return null;
}

/**
 * The StyleX line that wrote this declaration. A style key whose other properties the box lacks
 * can't be the one it got, and one whose values the box has likely is. A different value is weaker
 * evidence: another style may override it, or the minifier rewrote it.
 */
function findUse(
  index: SourceIndex,
  box: SnapBox,
  declaration: Declaration,
): { at: SourceRef; candidates: number } | null {
  const names = [camel(declaration.property), ...(BLOCK_ALIASES.get(declaration.property) ?? [])];
  const css = normalize(declaration.value);
  const sites = (index.uses.get(css) ?? []).filter((use) => names.includes(use.property));

  if (sites.length === 0) return null;
  const values = new Map<string, Set<string>>();

  for (const entry of box.declarations) {
    const key = camel(entry.property);
    values.set(key, (values.get(key) ?? new Set()).add(normalize(entry.value)));
  }

  const score = (use: StyleUse): number =>
    [...use.block].reduce((total, [key, css]) => {
      const own = values.get(key);

      if (own === undefined) return total - 1;

      return css.some((value) => own.has(value)) ? total + 1 : total - 0.5;
    }, 0);

  const ranked = [...sites].sort((a, b) => score(b) - score(a));
  const best = ranked[0];

  return best === undefined ? null : { at: best.at, candidates: sites.length };
}

function handleFor(index: SourceIndex, value: string): string | null {
  const css = normalize(value);

  for (const [name, handleCss] of index.handles) if (normalize(handleCss) === css) return name;

  return null;
}

function tokenChain(index: SourceIndex, token: string): TokenLink[] {
  const chain: TokenLink[] = [];
  const seen = new Set<string>();

  for (let name: string | undefined = token; name !== undefined && !seen.has(name);) {
    seen.add(name);
    const link: TokenLink = index.tokens.get(name) ?? { token: name, value: "", defined: null };
    chain.push(link);
    name = /var\((--nyte-[\w-]+)/u.exec(link.value)?.[1];
  }

  return chain;
}

function visitCalls(
  source: ts.SourceFile,
  visit: (call: ts.CallExpression, name: string, binding: string | null) => void,
): void {
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;

      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;

      if (name === "create" || name === "defineVars" || name === "defineConsts") {
        const parent = node.parent;

        const binding =
          ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
            ? parent.name.text
            : null;

        visit(node, name, binding);
      }
    }

    ts.forEachChild(node, walk);
  };

  walk(source);
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;

  return null;
}

function defaultString(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;

  if (!ts.isObjectLiteralExpression(node)) return null;

  const fallback = node.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === "default",
  );

  return fallback !== undefined && ts.isPropertyAssignment(fallback)
    ? defaultString(fallback.initializer)
    : null;
}

/** Every CSS text a style value can compile to: each branch of a conditional object, with handles inlined. */
function cssValues(
  node: ts.Expression,
  key: string,
  handles: ReadonlyMap<string, string>,
): string[] {
  if (ts.isObjectLiteralExpression(node))
    return node.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) ? cssValues(property.initializer, key, handles) : [],
    );

  const text = cssText(node, key, handles);

  return text === null ? [] : [normalize(text)];
}

function cssText(
  node: ts.Expression,
  key: string,
  handles: ReadonlyMap<string, string>,
): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;

  if (ts.isNumericLiteral(node))
    return UNITLESS.has(key) || node.text === "0" ? node.text : `${node.text}px`;

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = cssText(node.operand, key, handles);

    return inner === null ? null : `-${inner}`;
  }

  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression))
    return handles.get(`${node.expression.text}.${node.name.text}`) ?? null;

  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return handles.get(`${node.expression.text}.${node.argumentExpression.text}`) ?? null;

  if (ts.isTemplateExpression(node)) {
    const spans = node.templateSpans.map((span) => {
      const inner = cssText(span.expression, "", handles);

      return inner === null ? null : `${inner}${span.literal.text}`;
    });

    return spans.includes(null) ? null : `${node.head.text}${spans.join("")}`;
  }

  return null;
}

function refAt(file: { path: string; source: ts.SourceFile }, node: ts.Node): SourceRef {
  const start = node.getStart(file.source);
  const line = file.source.getLineAndCharacterOfPosition(start).line;

  return {
    path: file.path,
    line: line + 1,
    text: node.getText(file.source).split("\n")[0]?.trim().slice(0, 120) ?? "",
  };
}
