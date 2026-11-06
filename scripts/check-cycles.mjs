import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ScriptKind, SyntaxKind } from "@typescript/native/ast";
import {
  isExportDeclaration,
  isExternalModuleReference,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNamedExports,
} from "@typescript/native/ast/is";
import { API } from "@typescript/native/sync";

const root = resolve(import.meta.dirname, "..");

const api = new API();

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const DECLARATION = /\.d\.[cm]?ts$/;

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const CONDITIONS = ["nyte-source", "import", "default"];

const json = process.argv.includes("--json");

const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function readWorkspaces() {
  const listed = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  return JSON.parse(listed)
    .filter((entry) => entry.path !== root)
    .map((entry) => ({
      name: entry.name,
      directory: entry.path,
      manifest: JSON.parse(readFileSync(join(entry.path, "package.json"), "utf8")),
      paths: readPaths(entry.path),
    }));
}

function readPaths(directory) {
  const file = join(directory, "tsconfig.json");

  if (!existsSync(file)) return [];

  const { config } = api.readConfigFile(file);
  const paths = config?.compilerOptions?.paths ?? {};

  return Object.entries(paths).map(([pattern, [target]]) => {
    const [prefix, suffix = ""] = pattern.split("*");
    const [targetPrefix, targetSuffix = ""] = target.split("*");

    return {
      prefix,
      suffix,
      wildcard: pattern.includes("*"),
      target: resolve(directory, targetPrefix),
      targetSuffix,
    };
  });
}

function listSources(workspace, nested) {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."],
    { cwd: workspace.directory, encoding: "utf8" },
  );

  return listed
    .split("\n")
    .filter((path) => SOURCE.test(path) && !DECLARATION.test(path))
    .map((path) => join(workspace.directory, path))
    .filter((path) => !nested.some((directory) => path.startsWith(`${directory}/`)));
}

function resolveFile(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;

  for (const extension of EXTENSIONS) {
    if (existsSync(path + extension)) return path + extension;
  }

  const swapped = path.replace(/\.([cm]?)js(x?)$/, ".$1ts$2");

  if (swapped !== path && existsSync(swapped)) return swapped;

  if (existsSync(path) && statSync(path).isDirectory()) {
    for (const extension of EXTENSIONS) {
      const index = join(path, `index${extension}`);

      if (existsSync(index)) return index;
    }
  }

  return undefined;
}

function pickTarget(value) {
  if (String(value) === value) return value;

  if (Object(value) !== value) return undefined;

  for (const condition of CONDITIONS) {
    if (condition in value) return pickTarget(value[condition]);
  }

  return undefined;
}

function resolvePackage(workspace, subpath) {
  const exports = workspace.manifest.exports;

  if (exports === undefined) {
    return subpath === "." && workspace.manifest.main
      ? resolveFile(join(workspace.directory, workspace.manifest.main))
      : undefined;
  }

  const map = String(exports) === exports ? { ".": exports } : exports;
  const exact = pickTarget(map[subpath]);

  if (exact !== undefined) return resolveFile(join(workspace.directory, exact));

  for (const [key, value] of Object.entries(map)) {
    if (!key.endsWith("*") || !subpath.startsWith(key.slice(0, -1))) continue;

    const target = pickTarget(value);

    if (target === undefined) continue;

    return resolveFile(
      join(workspace.directory, target.replace("*", subpath.slice(key.length - 1))),
    );
  }

  return undefined;
}

function resolveSpecifier(specifier, from, owner, byName) {
  if (specifier.startsWith(".")) return resolveFile(resolve(dirname(from), specifier));

  for (const path of owner.paths) {
    if (path.wildcard) {
      if (!specifier.startsWith(path.prefix) || !specifier.endsWith(path.suffix)) continue;

      const middle = specifier.slice(path.prefix.length, specifier.length - path.suffix.length);
      const hit = resolveFile(path.target + middle + path.targetSuffix);

      if (hit !== undefined) return hit;
    } else if (specifier === path.prefix) {
      const hit = resolveFile(path.target);

      if (hit !== undefined) return hit;
    }
  }

  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const workspace = byName.get(name);

  if (workspace === undefined) return undefined;

  const rest = specifier.slice(name.length);

  return resolvePackage(workspace, rest === "" ? "." : `.${rest}`);
}

function readRuntimeImports(file) {
  if (!existsSync(file)) return [];

  using retained = api.createSourceFile(file, readFileSync(file, "utf8"), {
    scriptKind: file.endsWith("x") ? ScriptKind.TSX : ScriptKind.TS,
  });

  const source = retained.sourceFile;

  const specifiers = [];

  for (const statement of source.statements) {
    if (isImportDeclaration(statement)) {
      if (statement.importClause?.phaseModifier === SyntaxKind.TypeKeyword) continue;

      specifiers.push({ text: statement.moduleSpecifier.text, node: statement });
    } else if (isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (statement.isTypeOnly) continue;

      const elements =
        statement.exportClause && isNamedExports(statement.exportClause)
          ? statement.exportClause.elements
          : undefined;

      if (elements !== undefined && elements.length > 0 && elements.every((e) => e.isTypeOnly))
        continue;

      specifiers.push({ text: statement.moduleSpecifier.text, node: statement });
    } else if (
      isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      isExternalModuleReference(statement.moduleReference)
    ) {
      specifiers.push({ text: statement.moduleReference.expression.text, node: statement });
    }
  }

  return specifiers.map(({ text, node }) => ({
    text,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  }));
}

function findComponents(graph) {
  const order = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let counter = 0;

  for (const start of graph.keys()) {
    if (order.has(start)) continue;

    const work = [{ node: start, edges: [...graph.get(start).keys()], next: 0 }];
    order.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work.at(-1);

      if (frame.next < frame.edges.length) {
        const target = frame.edges[frame.next];
        frame.next += 1;

        if (!order.has(target)) {
          order.set(target, counter);
          low.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, edges: [...graph.get(target).keys()], next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node), order.get(target)));
        }

        continue;
      }

      work.pop();

      if (work.length > 0) {
        const parent = work.at(-1).node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }

      if (low.get(frame.node) !== order.get(frame.node)) continue;

      const component = [];
      let member;

      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== frame.node);

      components.push(component);
    }
  }

  return components;
}

function traceCycle(graph, component) {
  const members = new Set(component);
  const [start] = component.toSorted(byText);
  const previous = new Map([[start, null]]);
  const queue = [start];

  while (queue.length > 0) {
    const node = queue.shift();

    for (const target of graph.get(node).keys()) {
      if (!members.has(target)) continue;

      if (target === start) {
        const path = [node];

        while (previous.get(path[0]) !== null) path.unshift(previous.get(path[0]));

        return [...path, start].map((file, index, all) =>
          index === all.length - 1 ? file : `${file}:${graph.get(file).get(all[index + 1])}`,
        );
      }

      if (previous.has(target)) continue;

      previous.set(target, node);
      queue.push(target);
    }
  }

  return [start];
}

const workspaces = readWorkspaces();

const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));

const graph = new Map();

const owners = new Map();

for (const workspace of workspaces) {
  const nested = workspaces
    .filter((other) => other.directory.startsWith(`${workspace.directory}/`))
    .map((other) => other.directory);

  for (const file of listSources(workspace, nested)) owners.set(file, workspace);
}

for (const [file, owner] of owners) {
  const edges = new Map();

  for (const { text, line } of readRuntimeImports(file)) {
    const target = resolveSpecifier(text, file, owner, byName);

    if (target !== undefined && owners.has(target) && !edges.has(target)) edges.set(target, line);
  }

  graph.set(file, edges);
}

api.close();

const cycles = findComponents(graph)
  .filter((component) => component.length > 1 || graph.get(component[0]).has(component[0]))
  .map((component) => ({
    size: component.length,
    packages: [...new Set(component.map((file) => owners.get(file).name))].toSorted(byText),
    files: component.map((file) => relative(root, file)).toSorted(byText),
    cycle: traceCycle(graph, component).map((step) => relative(root, step)),
  }))
  .toSorted((left, right) => right.size - left.size);

const edgeCount = [...graph.values()].reduce((total, edges) => total + edges.size, 0);

if (json) {
  process.stdout.write(
    `${JSON.stringify({ files: graph.size, edges: edgeCount, cycles }, null, 2)}\n`,
  );
} else {
  for (const { size, packages, cycle } of cycles) {
    process.stdout.write(`${packages.join(", ")}: ${size} files\n  ${cycle.join("\n  -> ")}\n\n`);
  }

  process.stdout.write(
    `${graph.size} files, ${edgeCount} runtime imports, ${cycles.length} cycles.\n`,
  );
}

process.exitCode = cycles.length > 0 ? 1 : 0;
