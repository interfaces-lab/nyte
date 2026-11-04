/**
 * `pnpm lint` runs this. It fails when agent guidance points at something that is not there:
 *
 * - an AGENTS.md names a source location. Files move, and a path in agent guidance then sends the
 *   next agent to a file that is gone; AGENTS.md names the symbol or concept instead.
 * - a skill names a repository path or glob that matches no file, or a `pnpm` script its
 *   package.json lacks. Skills may name paths, so these must stay true.
 * - a skill's `paths` frontmatter glob matches no file.
 * - a relative Markdown link resolves to no file or folder.
 */
import { readFileSync } from "node:fs";
import { dirname, matchesGlob, posix } from "node:path";
import { listFiles, listSkillFiles, listSkills } from "./skills.mjs";

const ALLOWED = new Set(["AGENTS.md", "README.md", "RELEASING.md", "mise.toml"]);

const EXTENSION = /\.(?:[cm]?[jt]sx?|json|css|ya?ml|toml|md|sh|html)$/u;

/** Lint rule IDs (`nyte-code/declarative-comments`) look like paths; AGENTS.md may name configured ones. */
const RULES = new Set(
  [...readFileSync("oxlint.config.ts", "utf8").matchAll(/"([\w-]+\/[\w-]+)":/gu)].map(
    (match) => match[1],
  ),
);

/** A word in a skill's code is checked as a path only when it starts with one of these. */
const PATH_ROOTS = ["packages/", "scripts/", "docs/", ".github/", ".agents/", ".nyte/"];

/** pnpm's own commands. Any other first word names a package script. */
const PNPM_COMMANDS = new Set([
  "add",
  "audit",
  "create",
  "dlx",
  "exec",
  "i",
  "import",
  "init",
  "install",
  "licenses",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "rm",
  "store",
  "update",
  "up",
  "why",
]);

/** Generated, vendored or test material, and the docs site's routed MDX content. */
const UNCHECKED_MARKDOWN =
  /(?:^|\/)(?:node_modules|fixtures?|__fixtures__|test-?data|markdown-corpus)\/|(?:^|\/)CHANGELOG[^/]*$|^packages\/docs\/content\//iu;

const files = listFiles();

const skillFiles = listSkillFiles();

const entries = new Set(
  [...files, ...skillFiles].flatMap((file) => [
    file,
    ...file
      .split("/")
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
  ]),
);

const agents = files.filter((file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"));

const packages = new Map(
  files
    .filter((file) => file === "package.json" || file.endsWith("/package.json"))
    .map((file) => [
      file === "package.json" ? "." : dirname(file),
      JSON.parse(readFileSync(file, "utf8")),
    ]),
);

const markdown = [
  ...new Set([...files.filter((file) => file.endsWith(".md")), ...skillFiles]),
].filter((file) => !UNCHECKED_MARKDOWN.test(file));

const problems = [
  ...agents.flatMap((file) =>
    readCode(file)
      .filter((code) => !code.fenced && names(code.text))
      .map(
        (code) =>
          `${file}:${String(code.line)}: \`${code.text}\` names a location; name the symbol or concept instead`,
      ),
  ),
  ...skillFiles.flatMap((file) =>
    readCode(file).flatMap((code) =>
      [...findMissingPaths(code.text), ...findMissingScripts(code.text)].map(
        (problem) => `${file}:${String(code.line)}: ${problem}`,
      ),
    ),
  ),
  ...listSkills().flatMap((skill) =>
    skill.paths
      .filter((glob) => !files.some((file) => matchesGlob(file, glob)))
      .map((glob) => `${skill.file}: paths glob \`${glob}\` matches no file`),
  ),
  ...markdown.flatMap((file) =>
    readLines(file).flatMap((line) =>
      line.fenced
        ? []
        : [
            ...line.text.replaceAll(/`[^`]*`/gu, "").matchAll(/\]\(\s*<?([^)\s>]+)>?[^)]*\)/gu),
          ].flatMap((match) =>
            resolves(file, match[1] ?? "")
              ? []
              : [`${file}:${String(line.number)}: link \`${match[1] ?? ""}\` resolves to no file`],
          ),
    ),
  ),
];

for (const problem of problems) process.stderr.write(`${problem}\n`);

if (problems.length > 0) process.exit(1);

function names(code) {
  const word = code.split(/\s+/u)[0] ?? "";

  if (
    ALLOWED.has(word) ||
    RULES.has(word) ||
    files.includes(word) ||
    /^packages\/<[^>]+>\/AGENTS\.md$/u.test(word)
  )
    return false;

  if (word.startsWith("~/") || word.startsWith("@") || /^[a-z]+:\/\//u.test(word)) return false;

  if (word.includes("<") || word.startsWith("origin/")) return false;

  return EXTENSION.test(word) || /^\.?[\w-]+\/[\w./-]*$/u.test(word);
}

/** Each line of a Markdown file, marked when it sits inside a fenced code block. */
function readLines(file) {
  let open = false;

  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, index) => {
      const fence = /^\s*(?:```|~~~)/u.test(text);
      const fenced = open || fence;

      if (fence) open = !open;

      return { number: index + 1, text, fenced };
    });
}

/** Inline code spans, and whole lines of fenced blocks. */
function readCode(file) {
  return readLines(file).flatMap((line) =>
    line.fenced
      ? [{ line: line.number, text: line.text, fenced: true }]
      : [...line.text.matchAll(/`([^`]+)`/gu)].map((match) => ({
          line: line.number,
          text: match[1] ?? "",
          fenced: false,
        })),
  );
}

function findMissingPaths(code) {
  return code
    .split(/\s+/u)
    .map((word) =>
      word
        .replace(/^[("'=]+/u, "")
        .replace(/#.*$/u, "")
        .replace(/:[\d,-]+$/u, "")
        .replace(/[)"',.;:]+$/u, "")
        .replace(/\/$/u, ""),
    )
    .filter((word) => PATH_ROOTS.some((root) => word.startsWith(root)) && !/[<>$]/u.test(word))
    .filter((word) =>
      /[*?[{]/u.test(word)
        ? ![...entries].some((entry) => matchesGlob(entry, word))
        : !entries.has(word),
    )
    .map((word) => `\`${word}\` matches no file`);
}

function findMissingScripts(code) {
  return code
    .split(/\s*(?:&&|\|\||[;|])\s*/u)
    .map((command) => command.trim().split(/\s+/u))
    .filter((words) => words.includes("pnpm"))
    .map((words) => readPnpm(words.slice(words.indexOf("pnpm") + 1), {}))
    .flatMap((command) => {
      if (command === undefined) return [];

      const script = command.script.replace(/[)"',.;]+$/u, "");

      if (script === "" || PNPM_COMMANDS.has(script) || /[<>[$]/u.test(script)) return [];

      const target = findPackage(command);

      if (target === undefined) return [];

      if (target.json === undefined) return [`\`${target.name}\` names no workspace package`];

      return Object.hasOwn(target.json.scripts ?? {}, script)
        ? []
        : [`\`pnpm ${command.words}\`: ${target.dir}/package.json has no \`${script}\` script`];
    });
}

/** The package and script a pnpm command line runs, or undefined when it runs no single script. */
function readPnpm(words, target) {
  const flag = words[0] ?? "";
  const option = /^(--dir|-C|--filter|-F)(?:=(.*))?$/u.exec(flag);

  if (option !== null) {
    const value = option[2] ?? words[1] ?? "";
    const rest = words.slice(option[2] === undefined ? 2 : 1);
    const key = option[1] === "--dir" || option[1] === "-C" ? "dir" : "filter";

    return readPnpm(rest, { ...target, [key]: value });
  }

  if (flag === "-r" || flag === "--recursive") return undefined;

  if (flag.startsWith("-")) return readPnpm(words.slice(1), target);

  return {
    ...target,
    script: flag === "run" ? (words[1] ?? "") : flag,
    words: [
      target.dir === undefined ? "" : `--dir ${target.dir} `,
      target.filter === undefined ? "" : `--filter ${target.filter} `,
      words.join(" "),
    ].join(""),
  };
}

/** Undefined when the command names its package by a placeholder or pattern this cannot follow. */
function findPackage(command) {
  const name = (command.dir ?? command.filter ?? ".")
    .replace(/^["']|["']$/gu, "")
    .replace(/^\.{3}|\.{3}$|^\^/gu, "");

  if (/[<>*{$]/u.test(name)) return undefined;

  if (command.dir !== undefined || name.startsWith(".")) {
    const dir = posix.normalize(name).replace(/\/$/u, "");

    return { name, dir, json: packages.get(dir) };
  }

  const found = [...packages].find((entry) => entry[1].name === name);

  return { name, dir: found?.[0], json: found?.[1] };
}

function resolves(file, link) {
  if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/iu.test(link)) return true;

  const path = decodeURIComponent(link.replace(/[#?].*$/u, ""));

  if (path === "") return true;

  const target = posix.normalize(
    path.startsWith("/") ? `.${path}` : posix.join(dirname(file), path),
  );

  return target === "." || target === "./" || entries.has(target.replace(/\/$/u, ""));
}
