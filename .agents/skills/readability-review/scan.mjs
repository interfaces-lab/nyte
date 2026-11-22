import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const ABBREVIATIONS = new Map([
  ["arr", "name what the list holds"],
  ["btn", "button"],
  ["cb", "name what it does when called"],
  ["cfg", "config"],
  ["cnt", "count"],
  ["conf", "config"],
  ["ctx", "context"],
  ["el", "element"],
  ["elem", "element"],
  ["err", "error"],
  ["ev", "event"],
  ["evt", "event"],
  ["fn", "name the operation"],
  ["idx", "index"],
  ["impl", "name what it implements"],
  ["len", "length"],
  ["mgr", "name what it owns"],
  ["msg", "message"],
  ["msgs", "messages"],
  ["num", "name what it counts"],
  ["obj", "name what it is"],
  ["opts", "options"],
  ["req", "request"],
  ["res", "response or result"],
  ["resp", "response"],
  ["str", "name what the text is"],
  ["svc", "service"],
  ["tmp", "name what it holds"],
  ["util", "name the operation"],
  ["utils", "name the operations"],
  ["val", "value, or better, what it is"],
]);

const BRANDS = /OpenAI|macOS|iOS|iPadOS/gu;

const ACRONYM = /[A-Z]{3,}|(?:^|[a-z0-9])(?:ID|UI|IO|OS|DB|JS|TS)(?=[A-Z0-9]|$)/u;

const TYPE_SUFFIX = /[a-z](Array|String|Str|Obj|Object|Fn|Func|Bool|Boolean|Dict)$/u;

const CONSTANT = /^[A-Z][A-Z0-9_]*$/u;

const LAZY_ASSIGNMENTS = new Set([
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

const MUTATORS = new Set([
  "add",
  "clear",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const SKIPPED = /\.d\.ts$|\.gen\.|generated|\/fixtures\/|\.stylex\.ts$/u;

const args = process.argv.slice(2);
const whole = args.includes("--whole");
const baseFlag = args.indexOf("--base");
const base = baseFlag === -1 ? "HEAD" : args[baseFlag + 1];
const pathspecs = args.filter((arg, index) => !arg.startsWith("--") && index !== baseFlag + 1);

const changed = whole ? readWholeFiles() : readChangedLines();

const findings = [...changed]
  .filter((entry) => /\.tsx?$/u.test(entry[0]) && !SKIPPED.test(entry[0]) && existsSync(entry[0]))
  .flatMap((entry) => scanFile(entry[0]).filter((finding) => touches(finding, entry[1])))
  .toSorted((left, right) =>
    left.file === right.file
      ? left.line - right.line || left.rule.localeCompare(right.rule)
      : left.file.localeCompare(right.file),
  );

for (const finding of findings) {
  process.stdout.write(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}\n`);
}

process.stdout.write(
  `${findings.length} finding${findings.length === 1 ? "" : "s"} ${whole ? "in" : "on changed lines of"} ${changed.size} file${changed.size === 1 ? "" : "s"}\n`,
);

if (findings.length > 0) process.exit(1);

function scanFile(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found = [];

  const lineAt = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  const startLine = (node) => lineAt(node.getStart(source));
  const endLine = (node) => lineAt(node.getEnd());

  const report = (rule, node, message, anchors = []) => {
    const line = startLine(node);

    found.push({ file, line, rule, message, anchors: [line, ...anchors] });
  };

  const mutations = readMutations(source, startLine);

  const visit = (node) => {
    checkBinding(node);
    checkStatement(node);
    ts.forEachChild(node, visit);
  };

  const checkBinding = (node) => {
    const binding = readBinding(node);

    if (binding === undefined) return;

    const name = binding.id.text;

    if (name === "_" || name === "_exhaustive") return;

    if (/^_|_$/u.test(name)) {
      report(
        "underscore",
        binding.id,
        `\`${name}\`: drop the underscore. TypeScript's \`private\` or \`#\` marks privacy, and an unused parameter is removed or named for its role.`,
      );
    }

    if (ACRONYM.test(name.replaceAll(BRANDS, "Brand")) && !CONSTANT.test(name)) {
      report(
        "acronym-case",
        binding.id,
        `\`${name}\`: write an acronym as one word, as in \`loadHttpUrl\` and \`userId\`, so word boundaries stay visible.`,
      );
    }

    const abbreviation = splitWords(name).find((word) => ABBREVIATIONS.has(word));

    if (abbreviation !== undefined && binding.kind !== "member") {
      report(
        "abbreviation",
        binding.id,
        `\`${name}\`: \`${abbreviation}\` drops letters from a word; ${ABBREVIATIONS.get(abbreviation)}.`,
      );
    }

    if (name.length === 1 && binding.kind === "value") {
      const scope = findScope(node);
      const span = endLine(scope) - startLine(scope) + 1;

      if (span > 10) {
        report(
          "short-name",
          binding.id,
          `\`${name}\` lives across ${span} lines. A one-letter name only reads in a scope of ten lines or fewer.`,
        );
      }
    }

    if (binding.kind === "value" && TYPE_SUFFIX.test(name)) {
      report(
        "type-in-name",
        binding.id,
        `\`${name}\`: the type is already declared. Name what the value means, not what it is made of.`,
      );
    }

    if (ts.isInterfaceDeclaration(node) && /^I[A-Z][a-z]/u.test(name)) {
      report(
        "type-in-name",
        binding.id,
        `\`${name}\`: drop the \`I\` prefix. A caller should not care whether a type is an interface.`,
      );
    }

    checkConstantCase(node, binding, name);
  };

  const checkConstantCase = (node, binding, name) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;

    const list = node.parent;
    const constant = (list.flags & ts.NodeFlags.Const) !== 0;
    const moduleLevel = ts.isVariableStatement(list.parent) && list.parent.parent === source;
    const upper = CONSTANT.test(name);
    const value = unwrap(node.initializer);

    if (upper && (!moduleLevel || !constant)) {
      report(
        "constant-case",
        binding.id,
        `\`${name}\`: CONSTANT_CASE is for module-level values that never change. Use lowerCamelCase here.`,
      );
      return;
    }

    if (
      upper &&
      value !== undefined &&
      (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
    ) {
      report(
        "constant-case",
        binding.id,
        `\`${name}\` holds a function. Functions are lowerCamelCase, as a function declaration would be.`,
      );
      return;
    }

    const mutated = mutations.get(name) ?? [];

    if (upper && mutated.length > 0) {
      report(
        "constant-case",
        binding.id,
        `\`${name}\` is changed on line ${mutated.join(", ")}. CONSTANT_CASE promises it never changes; use lowerCamelCase.`,
        mutated,
      );
      return;
    }

    if (
      !upper &&
      moduleLevel &&
      constant &&
      value !== undefined &&
      isLiteral(value) &&
      !file.endsWith(".tsx")
    ) {
      report(
        "constant-case",
        binding.id,
        `\`${name}\` is a module-level literal that never changes. Write it in CONSTANT_CASE.`,
      );
    }
  };

  const checkStatement = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      !LAZY_ASSIGNMENTS.has(node.operatorToken.kind) &&
      !isStatementPosition(node)
    ) {
      report(
        "assignment-in-expression",
        node,
        `\`${node.getText(source).replaceAll(/\s+/gu, " ").slice(0, 40)}\` assigns inside an expression. Assign in its own statement, then use the value.`,
      );
    }

    const destructuring = readDestructuringProblem(node);

    if (destructuring !== undefined) report("destructuring", node.name, destructuring);
  };

  visit(source);

  return found;
}

function readBinding(node) {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
    return ts.isIdentifier(node.name) ? { id: node.name, kind: "value" } : undefined;
  }

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return node.name === undefined ? undefined : { id: node.name, kind: "declaration" };
  }

  if (
    (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return { id: node.name, kind: "member" };
  }

  return undefined;
}

function readMutations(source, startLine) {
  const mutations = new Map();

  const note = (root, node) => {
    if (!ts.isIdentifier(root) || !CONSTANT.test(root.text)) return;

    mutations.set(root.text, [...(mutations.get(root.text) ?? []), startLine(node)]);
  };

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATORS.has(node.expression.name.text)
    ) {
      note(node.expression.expression, node);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
    ) {
      note(node.left.expression, node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return mutations;
}

function readDestructuringProblem(node) {
  if (!ts.isVariableDeclaration(node) && !ts.isParameter(node)) return undefined;

  const pattern = node.name;

  if (!ts.isObjectBindingPattern(pattern) && !ts.isArrayBindingPattern(pattern)) return undefined;

  const elements = pattern.elements.filter((element) => ts.isBindingElement(element));

  if (ts.isVariableDeclaration(node)) {
    return elements.filter((element) => element.dotDotDotToken === undefined).length === 1 &&
      !ts.isForOfStatement(node.parent.parent)
      ? "This destructures one value. Read it with dot notation where it is used."
      : undefined;
  }

  if (
    elements.some((element) => !ts.isIdentifier(element.name) || element.propertyName !== undefined)
  ) {
    return "Keep a destructured parameter to one level of shorthand names. Read nested or renamed values in the body.";
  }

  const fallback = unwrap(node.initializer);

  if (
    fallback !== undefined &&
    !(ts.isObjectLiteralExpression(fallback) && fallback.properties.length === 0) &&
    !(ts.isArrayLiteralExpression(fallback) && fallback.elements.length === 0)
  ) {
    return "Put defaults on the left, inside the pattern, and default an optional destructured parameter to `{}`.";
  }

  return undefined;
}

function findScope(node) {
  const scope = node.parent;

  if (scope === undefined) return node;

  if (ts.isParameter(node) && ts.isFunctionLike(scope)) return scope;

  if (
    ts.isBlock(scope) ||
    ts.isSourceFile(scope) ||
    ts.isForStatement(scope) ||
    ts.isForOfStatement(scope) ||
    ts.isForInStatement(scope) ||
    ts.isCaseClause(scope) ||
    ts.isCatchClause(scope)
  ) {
    return scope;
  }

  return findScope(scope);
}

function isStatementPosition(node) {
  const parent = node.parent;

  if (ts.isParenthesizedExpression(parent)) return ts.isExpressionStatement(parent.parent);

  return (
    ts.isExpressionStatement(parent) ||
    (ts.isForStatement(parent) && parent.incrementor === node) ||
    (ts.isForStatement(parent) && parent.initializer === node) ||
    (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.CommaToken)
  );
}

function isLiteral(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand))
  );
}

function unwrap(node) {
  if (node === undefined) return undefined;

  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return unwrap(node.expression);
  }

  return node;
}

function splitWords(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[\s_]+/u)
    .filter((word) => word !== "");
}

function touches(finding, lines) {
  return lines === "all" || finding.anchors.some((line) => lines.has(line));
}

function readChangedLines() {
  const changed = new Map();
  const roots = pathspecs.length === 0 ? ["."] : pathspecs;

  const diff = git(["diff", "--unified=0", "--no-color", "--no-ext-diff", base, "--", ...roots]);

  let file;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? undefined : line.slice(6);
      continue;
    }

    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(line);

    if (hunk === null || file === undefined) continue;

    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(file) ?? new Set();

    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    changed.set(file, lines);
  }

  for (const file of git(["ls-files", "--others", "--exclude-standard", "--", ...roots]).split(
    "\n",
  )) {
    if (file !== "") changed.set(file, "all");
  }

  return changed;
}

function readWholeFiles() {
  const roots = pathspecs.length === 0 ? ["packages", "services", "scripts"] : pathspecs;

  return new Map(
    git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...roots])
      .split("\n")
      .filter((file) => file !== "")
      .map((file) => [file, "all"]),
  );
}

function git(command) {
  return execFileSync("git", command, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
