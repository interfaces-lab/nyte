/**
 * `pnpm guidance [--diff <ref>] [paths...]` lists the guidance a change should be read against:
 * every AGENTS.md in a folder above a changed file (the root one is always loaded, so it is left
 * out), and every skill whose `paths` frontmatter matches a changed file. Each is listed once,
 * with the first file that brought it in.
 *
 * Without paths it reads the files changed since the merge base with <ref> (default origin/main),
 * including uncommitted and new files.
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

const changed =
  named.length > 0 && args.values.diff === undefined
    ? named
    : [...new Set([...named, ...listChanged(args.values.diff ?? "origin/main")])];

const agents = listFiles()
  .filter((file) => file.endsWith("/AGENTS.md"))
  .toSorted()
  .flatMap((file) => {
    const folder = dirname(file);
    const covered = changed.filter((path) => path.startsWith(`${folder}/`));

    return covered.length === 0 ? [] : [`${file}: ${describe(covered)} under ${folder}/`];
  });

const skills = listSkills().flatMap((skill) => {
  const hits = changed.flatMap((path) => {
    const glob = matchSkill(skill, path, read);

    return glob === undefined ? [] : [{ path, glob }];
  });

  const first = hits[0];

  if (first === undefined) return [];

  const contains = skill.contains === undefined ? "" : ` and contains ${skill.contains.source}`;

  return [
    `skill ${skill.name} (${skill.file}): ${describe(hits.map((hit) => hit.path))} matching ${first.glob}${contains}`,
  ];
});

const count = `${String(changed.length)} file${changed.length === 1 ? "" : "s"}`;

if (changed.length === 0) process.stdout.write("No changed files.\n");
else if (agents.length + skills.length === 0)
  process.stdout.write(`Only the root AGENTS.md applies to ${count}.\n`);
else
  process.stdout.write(`Read before committing ${count}:\n${[...agents, ...skills].join("\n")}\n`);

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

function describe(paths) {
  return paths.length === 1 ? paths[0] : `${paths[0]} and ${String(paths.length - 1)} more`;
}

function read(file) {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true
    ? readFileSync(file, "utf8")
    : "";
}
