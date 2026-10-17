import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type Comment = ESTree.Comment;

type CodeScan = {
  readonly offset: number;
  readonly blankLine: boolean;
};

type Span = {
  readonly start: number;
  readonly end: number;
};

const DIRECTIVE =
  /^(?:(?:eslint|oxlint)-(?:disable|enable)(?:-next-line|-line)?\b|@ts-(?:expect-error|nocheck|check)\b|biome-ignore\b|prettier-ignore\b|oxfmt-ignore\b|istanbul\s+ignore\b|[cv]8\s+ignore\b|#(?:end)?region\b|@vite-ignore\b|webpack[A-Z]\w*:|[@#]__(?:PURE|NO_SIDE_EFFECTS)__|@jsx(?:ImportSource|Runtime|Frag)?\b|@(?:vitest|jest)-environment\b|@license\b|@preserve\b|[#@] sourceMappingURL=)/;

const TRIPLE_SLASH = /^\/\s*<(?:reference|amd-module|amd-dependency)\b/;

const TASK_MARKER = /\b(?:TODO|FIXME|XXX|HACK)\b/;

const LICENSE = /\b(?:copyright|license|spdx-license-identifier)\b/i;

const WHITESPACE = /\s/;

/** Read whether a comment is a tool directive: lint suppression, compiler pragma, bundler hint, or triple-slash reference. */
function readsAsDirective(comment: Comment): boolean {
  if (comment.type === "Line" && TRIPLE_SLASH.test(comment.value)) return true;
  return DIRECTIVE.test(comment.value.trim());
}

/** Read whether only spaces and tabs sit between the start of the line and `offset`. */
function startsOwnLine(text: string, offset: number): boolean {
  let cursor = offset - 1;

  while (cursor >= 0 && (text[cursor] === " " || text[cursor] === "\t")) cursor -= 1;
  return cursor < 0 || text[cursor] === "\n";
}

/** Skip whitespace and comments from `from` to the next code character, noting whether a blank line was crossed. */
function scanToCode(text: string, from: number, commentsByStart: Map<number, Comment>): CodeScan {
  let offset = from;
  let newlines = 0;
  let blankLine = false;

  while (offset < text.length) {
    const comment = commentsByStart.get(offset);

    if (comment !== undefined) {
      offset = comment.end;
      newlines = 0;
      continue;
    }

    const character = text[offset];

    if (character === "\n") {
      newlines += 1;
      blankLine ||= newlines > 1;
    } else if (!WHITESPACE.test(character)) {
      break;
    }

    offset += 1;
  }

  return { offset, blankLine };
}

/** Group comments into units: one block comment, or a run of `//` lines each on its own consecutive line. */
function groupUnits(text: string, comments: readonly Comment[]): Comment[][] {
  const units: Comment[][] = [];
  let run: Comment[] | null = null;

  for (const comment of comments) {
    const previous = run?.at(-1);
    const continuesRun =
      previous !== undefined &&
      comment.type === "Line" &&
      startsOwnLine(text, comment.start) &&
      comment.loc.start.line === previous.loc.end.line + 1;

    if (comment.type === "Shebang" || readsAsDirective(comment)) {
      run = null;
    } else if (run !== null && continuesRun) {
      run.push(comment);
    } else {
      run = comment.type === "Line" && startsOwnLine(text, comment.start) ? [comment] : null;
      units.push(run ?? [comment]);
    }
  }

  return units;
}

/**
 * Allow only declarative comments. A comment unit (one block comment, or a run of `//` lines on consecutive
 * lines) is allowed when it is a tool directive; a file header before the first code that is JSDoc (the
 * module's documentation) or names a license; or sits on its own line outside every function body,
 * directly above a declaration with no blank line between, as either a JSDoc block or exactly one `//` line.
 * Declarations are statements and members that introduce a name (variables, functions, classes, types,
 * interfaces, enums, namespaces, exports, class, interface and enum members, object properties) plus the
 * members of a union type or an array literal. Task markers (`TASK_MARKER`) are never allowed.
 */
export const declarativeCommentsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Allow only JSDoc or one `//` line directly above a declaration, license headers, and tool directives.",
    },
    messages: {
      taskMarker:
        "Task markers (TODO, FIXME, XXX, HACK) are not allowed. Do the work, or track it outside the code.",
      functionBody:
        "Comments inside a function body are not allowed. Name the step with a function or variable, or move the reason into the JSDoc of the enclosing declaration.",
      trailing:
        "Trailing and inline comments are not allowed. Put the reason on its own line directly above the declaration it explains, or delete it.",
      detached:
        "This comment documents no declaration. Place it directly above a declaration with no blank line between, or delete it.",
      blockComment: "Use JSDoc (/** */) or a single // line above the declaration, not /* */.",
      lineRun:
        "{{count}} // lines above one declaration must be a single JSDoc block (/** */), or a single line.",
    },
  },
  createOnce(context) {
    let declarationStarts = new Set<number>();
    let functionBodies: Span[] = [];

    const recordDeclaration = (node: Span) => {
      declarationStarts.add(node.start);
    };

    const recordFunction = (node: ESTree.ArrowFunctionExpression | ESTree.Function) => {
      if (node.body === null) return;
      functionBodies.push(node.body.type === "BlockStatement" ? node.body : node);
    };

    return {
      before() {
        declarationStarts = new Set();
        functionBodies = [];
      },
      VariableDeclaration: recordDeclaration,
      FunctionDeclaration(node) {
        recordDeclaration(node);
        recordFunction(node);
      },
      FunctionExpression: recordFunction,
      ArrowFunctionExpression: recordFunction,
      StaticBlock(node) {
        functionBodies.push(node);
      },
      TSDeclareFunction: recordDeclaration,
      ClassDeclaration: recordDeclaration,
      TSTypeAliasDeclaration: recordDeclaration,
      TSInterfaceDeclaration: recordDeclaration,
      TSEnumDeclaration: recordDeclaration,
      TSEnumMember: recordDeclaration,
      TSModuleDeclaration: recordDeclaration,
      TSGlobalDeclaration: recordDeclaration,
      ExportNamedDeclaration: recordDeclaration,
      ExportDefaultDeclaration: recordDeclaration,
      ExportAllDeclaration: recordDeclaration,
      TSExportAssignment: recordDeclaration,
      MethodDefinition: recordDeclaration,
      TSAbstractMethodDefinition: recordDeclaration,
      PropertyDefinition: recordDeclaration,
      TSAbstractPropertyDefinition: recordDeclaration,
      AccessorProperty: recordDeclaration,
      TSIndexSignature: recordDeclaration,
      TSPropertySignature: recordDeclaration,
      TSMethodSignature: recordDeclaration,
      TSCallSignatureDeclaration: recordDeclaration,
      TSConstructSignatureDeclaration: recordDeclaration,
      Property(node) {
        if (node.parent.type === "ObjectExpression") recordDeclaration(node);
      },
      ArrayExpression(node) {
        for (const element of node.elements) {
          if (element !== null) recordDeclaration(element);
        }
      },
      TSUnionType(node) {
        for (const member of node.types) {
          const separator = context.sourceCode.getTokenBefore(member);

          if (separator?.value === "|") recordDeclaration(separator);
          recordDeclaration(member);
        }
      },
      "Program:exit"() {
        const { text } = context.sourceCode;
        const comments = context.sourceCode.getAllComments();
        const commentsByStart = new Map(comments.map((comment) => [comment.start, comment]));
        const firstCode = scanToCode(text, 0, commentsByStart).offset;

        for (const unit of groupUnits(text, comments)) {
          const [first] = unit;
          const last = unit.at(-1) ?? first;
          const report = (messageId: string, data?: Record<string, string>) => {
            context.report({ loc: first.loc, messageId, data });
          };

          if (unit.some((comment) => TASK_MARKER.test(comment.value))) {
            report("taskMarker");
            continue;
          }

          if (
            last.end <= firstCode &&
            ((first.type === "Block" && first.value.startsWith("*")) ||
              unit.some((comment) => LICENSE.test(comment.value)))
          ) {
            continue;
          }

          if (functionBodies.some((body) => first.start > body.start && last.end <= body.end)) {
            report("functionBody");
            continue;
          }

          if (!startsOwnLine(text, first.start)) {
            report("trailing");
            continue;
          }

          const next = scanToCode(text, last.end, commentsByStart);

          if (next.blankLine || !declarationStarts.has(next.offset)) {
            report("detached");
            continue;
          }

          if (first.type === "Block" && !first.value.startsWith("*")) report("blockComment");
          if (unit.length > 1) report("lineRun", { count: String(unit.length) });
        }
      },
    };
  },
});
