import { basename, extname, join } from "node:path";
import type { FormatOutcome } from "@nyte-ai/schema";
import { findExecutable, projectBins, run } from "../process/command.ts";
import type { Ran } from "../process/command.ts";

interface Formatter {
  readonly name: string;
  readonly extensions: ReadonlySet<string>;
  readonly project: boolean;
  arguments(path: string): readonly string[];
}

const SCRIPTS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];

const WEB = [
  ...SCRIPTS,
  ".json",
  ".jsonc",
  ".json5",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".vue",
  ".md",
  ".markdown",
  ".mdx",
  ".yaml",
  ".yml",
  ".graphql",
  ".gql",
  ".hbs",
  ".handlebars",
];

const FORMATTERS: readonly Formatter[] = [
  { name: "gofmt", extensions: new Set([".go"]), project: false, arguments: () => [] },
  {
    name: "ruff",
    extensions: new Set([".py", ".pyi"]),
    project: true,
    arguments: (path) => ["format", "--stdin-filename", path, "-"],
  },
  {
    name: "oxfmt",
    extensions: new Set([...WEB, ".toml"]),
    project: true,
    arguments: (path) => [`--stdin-filepath=${path}`],
  },
  {
    name: "prettier",
    extensions: new Set(WEB),
    project: true,
    arguments: (path) => ["--stdin-filepath", path],
  },
  {
    name: "biome",
    extensions: new Set([...SCRIPTS, ".json", ".jsonc", ".css", ".graphql", ".gql"]),
    project: true,
    arguments: (path) => ["format", `--stdin-file-path=${path}`],
  },
];

export async function format(
  root: string,
  path: string,
  contents: string,
  formatter: string | undefined,
): Promise<FormatOutcome> {
  const extension = extname(path).toLowerCase();

  const command =
    formatter === undefined ? await detectFormatter(root, path) : pin(formatter, path);

  if (command === null) {
    return {
      kind: "unavailable",
      reason:
        extension === ""
          ? "No formatter for this file is installed."
          : `No formatter for ${extension} files is installed.`,
    };
  }

  let ran: Ran;

  try {
    ran = await run(command.binary, command.arguments, { cwd: root, input: contents });
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }

  if (ran.code !== 0) {
    return {
      kind: "failed",
      reason: `${command.name} could not format ${basename(path)}: ${ran.stderr.trim()}`,
    };
  }
  const formatted = ran.stdout.toString("utf8");

  return formatted === contents
    ? { kind: "unchanged" }
    : { kind: "formatted", contents: formatted };
}

interface FormatCommand {
  readonly binary: string;
  readonly name: string;
  readonly arguments: readonly string[];
}

function pin(binary: string, path: string): FormatCommand | null {
  const name = basename(binary).replace(/\.(cmd|exe)$/i, "");
  const known = FORMATTERS.find((formatter) => formatter.name === name);

  if (known === undefined) return { binary, name, arguments: ["--stdin-filepath", path] };

  return known.extensions.has(extname(path).toLowerCase())
    ? { binary, name, arguments: known.arguments(path) }
    : null;
}

async function detectFormatter(root: string, path: string): Promise<FormatCommand | null> {
  const extension = extname(path).toLowerCase();
  const candidates = FORMATTERS.filter((formatter) => formatter.extensions.has(extension));

  const places = [
    ...projectBins(root).flatMap((folder) =>
      candidates.flatMap((formatter) =>
        formatter.project ? [{ formatter, lookup: join(folder, formatter.name) }] : [],
      ),
    ),
    ...candidates.map((formatter) => ({ formatter, lookup: formatter.name })),
  ];

  for (const place of places) {
    const binary = await findExecutable(place.lookup);

    if (binary !== null) {
      return { binary, name: place.formatter.name, arguments: place.formatter.arguments(path) };
    }
  }

  return null;
}
