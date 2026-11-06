import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";

export function listFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file !== "" && existsSync(file));
}

export function listSkillFiles() {
  return [".agents/skills", ".nyte/skills"]
    .filter((root) => existsSync(root))
    .flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter(
          (entry) =>
            entry.endsWith(".md") && !entry.split("/").some((part) => part.startsWith("pnpm-")),
        )
        .map((entry) => join(root, entry)),
    );
}

export function listSkills() {
  return listSkillFiles()
    .filter((file) => file.endsWith("/SKILL.md"))
    .map((file) => readSkill(file));
}

function readSkill(file) {
  const lines = (readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "").split("\n");

  const items = lines.includes("paths:") ? lines.slice(lines.indexOf("paths:") + 1) : [];
  const end = items.findIndex((line) => !/^\s+-\s/u.test(line));

  const paths = items
    .slice(0, end === -1 ? undefined : end)
    .map((line) => unquote(line.replace(/^\s+-/u, "")));

  const contains = lines.map((line) => /^contains:\s*(.+)$/u.exec(line)?.[1]).find(Boolean);
  const name = lines.map((line) => /^name:\s*(.+)$/u.exec(line)?.[1]).find(Boolean);

  return {
    file,
    name: name === undefined ? file : unquote(name),
    paths,
    contains: contains === undefined ? undefined : new RegExp(unquote(contains), "u"),
  };
}

export function matchSkill(skill, file, read) {
  const glob = skill.paths.find((pattern) => matchesGlob(file, pattern));

  if (glob === undefined) return undefined;

  if (skill.contains !== undefined && !skill.contains.test(read(file))) return undefined;

  return glob;
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/u, "$2");
}
