/**
 * Fails when an AGENTS.md names a source location. Files move, and a path in agent guidance then
 * sends the next agent to a file that is gone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["AGENTS.md", "README.md", "RELEASING.md", "mise.toml"]);

const EXTENSION = /\.(?:[cm]?[jt]sx?|json|css|ya?ml|toml|md|sh|html)$/u;

const files = execFileSync("git", ["ls-files", "*AGENTS.md"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file !== "");

const problems = files.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(/`([^`]+)`/gu)].flatMap((match) => {
        const code = match[1] ?? "";

        return names(code)
          ? [
              `${file}:${String(index + 1)}: \`${code}\` names a location; name the symbol or concept instead`,
            ]
          : [];
      }),
    ),
);

for (const problem of problems) process.stderr.write(`${problem}\n`);

if (problems.length > 0) process.exit(1);

function names(code) {
  const word = code.split(/\s+/u)[0] ?? "";

  if (ALLOWED.has(word) || files.includes(word) || /^packages\/<[^>]+>\/AGENTS\.md$/u.test(word))
    return false;

  if (word.startsWith("~/") || word.startsWith("@") || /^[a-z]+:\/\//u.test(word)) return false;

  if (word.includes("<") || word.startsWith("origin/")) return false;

  return EXTENSION.test(word) || /^\.?[\w-]+\/[\w./-]*$/u.test(word);
}
