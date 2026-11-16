import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";
import { blankLiterals, swiftFiles } from "./swift-source.mjs";

const root = join(import.meta.dirname, "..");
const sources = join(root, "Sources");

const developmentTargets = new Set(["NyteProbe", "NyteGallery", "NyteShot"]);
const entryFiles = /(^|\/)main\.swift$/u;
const generated = /\.generated\.swift$/u;
const fileLimit = 600;
const bridges = {
  GhosttyVt: [/^NyteTerminal\/TerminalEngine(?:\+\w+)?\.swift$/u],
  PtySpawn: [/^NyteTerminal\/LocalPTYBackend(?:\+\w+)?\.swift$/u],
  Md4c: [/^NyteUI\/Markdown\//u],
  BeautifulMermaid: [/^NyteDiagrams\//u],
};
const forcedBy = /^\/\/ (AppKit|macOS|Darwin|POSIX|TextKit|Core Animation|Core Text|Core Graphics|Swift|SwiftPM|LSP|DAP|gopls|tsserver|Delve|js-debug|libghostty|md4c|Mermaid|git|Nyte host): \S/u;

const lineRules = [
  ["iuo", /\b(?:var|let) \w+: [\w.<>\[\]]+!(?:\s|$)/u, "an implicitly unwrapped optional"],
  ["notification", /Notification\.Name\(/u, "a custom notification; wire a closure or a typed stream"],
  ["trap", /\b(?:preconditionFailure|fatalError)\(/u, "a trap; use assertionFailure and a safe return"],
  ["snake", /\b(?:let|var) [a-z]+_[a-z]/u, "a snake_case name"],
  ["dropped-call", /try\? await \w+\.call\(/u, "a host call whose failure is dropped"],
  ["defaults-dictionary", /UserDefaults[\w.]*\.dictionary\(forKey:/u, "saved state read as an untyped dictionary"],
];
const multilineRules = [
  ["main-hop-assume", /DispatchQueue\.main\.async[^\n]*\n[^\n]*\n?[^\n]*MainActor\.assumeIsolated/gu, "assumeIsolated inside a main-queue hop"],
  ["nonisolated-assume", /nonisolated func[^{]*\{\s*assumeIsolated/gu, "a nonisolated method that only asserts its isolation"],
  ["sleep-no-cancel", /try\? await Task\.sleep[^\n]*\n(?![^\n]*(?:Task\.isCancelled|guard))/gu, "a sleep with no cancellation check after it"],
];

const wanted = process.argv.slice(2);
const folders = wanted.length > 0 ? wanted.map((name) => join(sources, name)) : [sources];
const files = (await Promise.all(folders.map(swiftFiles))).flat();
const findings = [];

for (const file of files) {
  const name = relative(sources, file);
  if (generated.test(name)) continue;
  const target = name.split("/")[0];
  const development = developmentTargets.has(target);
  const text = await readFile(file, "utf8");
  const lines = blankLiterals(text);
  const report = (index, id, what) => findings.push(`${name}:${index + 1}: ${id}: ${what}`);

  if (lines.length > fileLimit) report(0, "file-length", `${lines.length} lines; split by topic`);

  for (const [module, allowed] of Object.entries(bridges)) {
    const index = lines.findIndex((line) => line.trim() === `import ${module}`);
    if (index >= 0 && !allowed.some((pattern) => pattern.test(name))) {
      report(index, "bridge", `${module} imported outside its bridge`);
    }
  }

  lines.forEach((code, index) => {
    const comment = code.match(/(?:^|\s)(\/\/.*)$/u)?.[1];
    if (comment && !forcedBy.test(comment) && !/^\/\/ swift-tools-version/u.test(comment)) {
      report(index, "comment", "a comment; say it in a name or a type, or name what forces it");
    }
    if (/^\s*\/\*/u.test(code)) report(index, "comment", "a block comment");
    const bare = code.replace(/\/\/.*$/u, "");
    for (const [id, pattern, what] of lineRules) {
      if (!pattern.test(bare)) continue;
      if (id === "trap" && /init\??\(coder/u.test(lines.slice(Math.max(0, index - 2), index + 1).join("\n"))) continue;
      report(index, id, what);
    }
    if (!development && /\bprint\(/u.test(bare)) report(index, "print", "print in a product target; use the module's Logger");
    if (!development && !entryFiles.test(name) && /^(?:public |private |fileprivate |internal )?(?:func|var|let) /u.test(bare)) {
      report(index, "top-level", "a top-level declaration; put it in a type or a caseless enum");
    }
  });

  for (const [id, pattern, what] of multilineRules) {
    for (const match of text.matchAll(pattern)) {
      report(text.slice(0, match.index).split("\n").length - 1, id, what);
    }
  }
}

if (findings.length > 0) {
  const counts = new Map();
  for (const finding of findings) {
    const id = finding.split(": ")[1];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const summary = [...counts].sort((a, b) => b[1] - a[1]).map(([id, count]) => `${id} ${count}`).join(", ");
  process.stderr.write(`${findings.join("\n")}\n\n${findings.length} rule finding${findings.length === 1 ? "" : "s"} (${summary}).\n`);
  process.exit(1);
}

process.stdout.write(`rules: ${files.length} files clean\n`);
