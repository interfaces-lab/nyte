import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import type { Connection } from "@nyte-ai/sdk";
import { CliError } from "./cli/errors.ts";
import { printable } from "./cli/format.ts";
import type { Row } from "./cli/format.ts";
import { parseCommandArgs } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { confirm } from "./cli/prompt.ts";
import { addFolder } from "./run.ts";

interface TrustInput {
  readonly args: readonly string[];
  readonly output: Output;
  readonly signal: AbortSignal;
  /** Opens the host connection, starting a host when none runs. */
  readonly connection: () => Promise<Connection>;
}

/** What `projectResources` holds for the folder and what its files are, as the host sees them now. */
interface Folder {
  readonly path: string;
  readonly decision: boolean | null;
  readonly trusted: boolean | null;
  /** From a fresh scan; the workspace record keeps the list from when the folder was added. */
  readonly sources: readonly string[];
}

type Outcome = "trusted" | "untrusted" | "unchanged";

const SHOWN = 5;

const CANCELED = new CliError("canceled", "Canceled. Nothing changed.");

/**
 * A trust change reloads every chat the host has loaded (core's `trustChanged`), and the MCP API
 * reads trust on each call, so the next `nyte mcp list` sees it.
 */
const APPLIES: Row = { label: "Open chats", value: "Reload with the change now" };

/**
 * `nyte trust [<FOLDER>] [--yes] [--json]`. Trusted project files can run code, so this is the
 * confirmation tier: the preview lists them and asks on a terminal; otherwise only `--yes` goes
 * ahead, and that check runs before any host work.
 */
export async function trustCommand(input: TrustInput): Promise<void> {
  const args = parseCommandArgs("trust", input.args, 1);
  const path = await resolveFolder(args.positionals[0], "trust");
  const out = input.output;
  const yes = args.has("yes");
  const shown = printable(path);

  if (!yes && !out.mode.interactive)
    throw new CliError(
      "missing_input",
      `Can't trust ${shown} without --yes in non-interactive mode.`,
      {
        next: [
          {
            label: "Only after a human approves, trust it",
            argv: ["nyte", "trust", path, "--yes"],
          },
        ],
      },
    );

  const host = await input.connection();
  const before = await readFolder(host, path);

  if (before.decision === true) return unchanged(out, args.has("json"), before, "trusted");

  if (!yes) {
    showPreview(out, before);

    if (!(await confirm(out, `Trust ${shown}?`, input.signal))) throw CANCELED;
  }

  const after = await decide(host, before, true);

  out.rows([
    { gutter: "done", label: "Trusted", value: shown },
    ...listRows("Loads", after.sources, "Project files added later"),
    APPLIES,
  ]);
  answer(out, args.has("json"), after, "trusted");
}

/** `nyte untrust [<FOLDER>] [--json]`: the ordinary tier, so it never asks. It records `false` even when no decision made the folder untrusted already. */
export async function untrustCommand(input: TrustInput): Promise<void> {
  const args = parseCommandArgs("untrust", input.args, 1);
  const path = await resolveFolder(args.positionals[0], "untrust");
  const out = input.output;
  const host = await input.connection();
  const before = await readFolder(host, path);

  if (before.decision === false) return unchanged(out, args.has("json"), before, "untrusted");

  const after = await decide(host, before, false);

  out.rows([
    { gutter: "done", label: "Untrusted", value: printable(path) },
    { label: "Skips", value: "Skills, prompts, plugins and MCP servers" },
    APPLIES,
  ]);
  answer(out, args.has("json"), after, "untrusted");
}

/**
 * The folder's absolute real path, the form the host keys trust by. The home folder is refused:
 * the host never trusts it (`readFolderTrust`), because its `.nyte` files are the user's own.
 */
async function resolveFolder(
  given: string | undefined,
  verb: "trust" | "untrust",
): Promise<string> {
  const absolute = resolve(given ?? process.cwd());
  const real = await realpath(absolute).catch(() => null);
  const directory = real !== null && (await stat(real)).isDirectory();

  if (real === null || !directory)
    throw new CliError("not_found", `Can't find a folder at ${printable(absolute)}.`);

  if (real === (await realpath(homedir())))
    throw new CliError(
      "invalid_arguments",
      `Can't ${verb} your home folder. Nyte reads its .nyte files as your user files.`,
    );

  return real;
}

/** Reads without registering: a folder the host doesn't have yet has no decision on a workspace. */
async function readFolder(host: Connection, path: string): Promise<Folder> {
  const seen = await host.workspaces.inspect({ kind: "local", path });
  const info = seen.registered === null ? null : await host.workspace(seen.registered).info();

  return {
    path,
    decision: info?.projectResources ?? null,
    trusted: info?.trusted ?? null,
    sources: seen.projectSources,
  };
}

/** Registers the folder, since it was named, then records the decision and reads it back. */
async function decide(host: Connection, folder: Folder, trusted: boolean): Promise<Folder> {
  const workspace = host.workspace(await addFolder(host, folder.path));
  const outcome = await workspace.update({ projectResources: trusted });

  if (outcome.kind === "missing")
    throw new CliError(
      "failed",
      `Couldn't save the decision. Nyte forgot ${printable(folder.path)} meanwhile.`,
    );
  const info = await workspace.info();

  return { ...folder, decision: info.projectResources, trusted: info.trusted };
}

function showPreview(out: Output, folder: Folder): void {
  out.rows([
    { label: "Folder", value: printable(folder.path) },
    ...listRows("Project files", folder.sources, "None yet"),
  ]);
  out.say("");
  out.status(
    "none",
    folder.sources.length === 0
      ? "Trusting it lets project files added later run code on this machine."
      : "Trusting it lets these files run code on this machine.",
  );
}

/** One row per file under `label`, at most `SHOWN`, then `and <N> more`. */
function listRows(label: string, sources: readonly string[], empty: string): Row[] {
  if (sources.length === 0) return [{ label, value: empty }];
  const rest = sources.length - SHOWN;

  return [
    ...sources
      .slice(0, SHOWN)
      .map((source, index) => ({ label: index === 0 ? label : "", value: printable(source) })),
    ...(rest > 0 ? [{ label: "", value: `and ${String(rest)} more` }] : []),
  ];
}

function unchanged(
  out: Output,
  json: boolean,
  folder: Folder,
  state: "trusted" | "untrusted",
): void {
  out.status("none", `${printable(folder.path)} is already ${state}. Nothing changed.`);
  answer(out, json, folder, "unchanged");
}

/** The folder is the identifier: its path on stdout for a script, or the whole state with `--json`. */
function answer(out: Output, json: boolean, folder: Folder, outcome: Outcome): void {
  if (json) {
    out.json({
      folder: {
        path: folder.path,
        trusted: folder.trusted,
        decision: folder.decision,
        projectSources: folder.sources,
      },
      outcome,
    });

    return;
  }

  if (!out.mode.tty.stdout || !out.mode.interactive) out.result(`${folder.path}\n`);
}
