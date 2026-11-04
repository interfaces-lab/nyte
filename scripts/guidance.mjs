/**
 * `pnpm guidance [--diff <ref>] [paths...]` lists the guidance a change should be read against:
 * every AGENTS.md in a folder above a changed file (the root one is always loaded, so it is left
 * out), and every skill whose `paths` frontmatter matches a changed file. Each is listed once,
 * with its length and the files that brought it in.
 *
 * It reads, in order: the named paths; with `--diff`, the files changed since the merge base with
 * <ref>; the staged files, which are what the next commit holds; and with nothing staged, the files
 * changed since the merge base with origin/main, uncommitted and new files included. A checkout
 * other agents also work in has their changes there too, so stage first.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listFiles, listSkills, matchSkill } from "./skills.mjs";

const root = resolve(import.meta.dirname, "..");

const args = parseArgs({ options: { diff: { type: "string" } }, allowPositionals: true });

const named = args.positionals.map((path) => relative(root, resolve(path)));

process.chdir(root);

const scope = readScope(named, args.values.diff);

const changed = scope.files;

const agents = listFiles()
  .filter((file) => file.endsWith("/AGENTS.md"))
  .toSorted()
  .flatMap((file) => {
    const folder = dirname(file);
    const covered = changed.filter((path) => path.startsWith(`${folder}/`));

    return covered.length === 0 ? [] : [`${file}, ${countLines(file)}: ${describe(covered)}`];
  });

const skills = listSkills().flatMap((skill) => {
  const hits = changed.flatMap((path) => {
    const glob = matchSkill(skill, path, read);

    return glob === undefined ? [] : [{ path, glob }];
  });

  const first = hits[0];

  if (first === undefined) return [];

  const contains = skill.contains === undefined ? "" : ` and containing ${skill.contains.source}`;

  return [
    `skill ${skill.name}, ${skill.file}, ${countLines(skill.file)}: ${describe(hits.map((hit) => hit.path))}, matching ${first.glob}${contains}`,
  ];
});

const count = `${String(changed.length)} ${changed.length === 1 ? "file" : "files"} ${scope.label}`;

if (changed.length === 0) process.stdout.write("No changed files.\n");
else if (agents.length + skills.length === 0)
  process.stdout.write(`Only the root AGENTS.md applies to ${count}.\n`);
else
  process.stdout.write(`Read before committing ${count}:\n${[...agents, ...skills].join("\n")}\n`);

function readScope(paths, ref) {
  if (paths.length > 0 && ref === undefined) return { label: "named", files: paths };

  if (ref !== undefined) {
    return { label: `changed since ${ref}`, files: [...new Set([...paths, ...listChanged(ref)])] };
  }

  const staged = git("diff", "--cached", "--name-only");

  if (staged.length > 0) return { label: "staged", files: staged };

  return { label: "changed since origin/main", files: [...new Set(listChanged("origin/main"))] };
}

function listChanged(ref) {
  return [
    ...git("diff", "--name-only", "--merge-base", ref),
    ...git("ls-files", "--others", "--exclude-standard"),
  ];
}

function git(...command) {
  return execFileSync("git", command, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");
}

/** Up to three paths, then a count, so a long change still fits on one line. */
function describe(paths) {
  const shown = paths.slice(0, 3).join(", ");

  return paths.length <= 3 ? shown : `${shown} and ${String(paths.length - 3)} more`;
}

function countLines(file) {
  const lines = read(file).trimEnd().split("\n").length;

  return `${String(lines)} line${lines === 1 ? "" : "s"}`;
}

function read(file) {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true
    ? readFileSync(file, "utf8")
    : "";
}
