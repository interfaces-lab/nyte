/**
 * The core plugin that holds the release-notes session to reading: `read` and `list`, and `bash`
 * only for read-only git and gh commands and the text tools that search or trim their output.
 * `scripts/release.mjs` copies it into the host's plugin directory and loads it for that one
 * session through `plugins.replace`, so it stays free of imports: the host imports it as a file.
 */

const AGENT = "release-notes";

const DENIED =
  "Denied: this session may only read files and run read-only git and gh commands, rg or grep, optionally piped into head, tail, wc, sort, uniq or cut, with no ; & $ ` < > ( ) or backslashes.";

const GIT_READS = [
  "blame",
  "cat-file",
  "describe",
  "diff",
  "for-each-ref",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "name-rev",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "status",
];

/** Whether `refspec` writes only remote-tracking refs or tags; one without a destination writes `FETCH_HEAD` alone. */
function fetchesSafely(refspec) {
  const destination = refspec.replace(/^\+/u, "").split(":")[1];

  return (
    destination === undefined ||
    destination === "" ||
    destination.startsWith("refs/remotes/") ||
    destination.startsWith("refs/tags/")
  );
}

/** `git fetch` without a hook into what runs on either side or a refspec that writes local branches. */
function allowedFetch(args) {
  if (args.some((arg) => /^(--upload-pack|--refmap|--recurse-submodules|-u)/u.test(arg)))
    return false;

  return args.filter((arg) => !arg.startsWith("-")).every(fetchesSafely);
}

function allowedGit(args) {
  const [subcommand, ...rest] = args[0] === "--no-pager" ? args.slice(1) : args;

  if (rest.some((arg) => arg.startsWith("--output"))) return false;

  if (subcommand === "fetch") return allowedFetch(rest);

  if (subcommand === "tag")
    return (
      rest.some((arg) => arg === "-l" || arg === "--list") &&
      !rest.some((arg) => ["-d", "--delete", "-f", "--force"].includes(arg))
    );

  return GIT_READS.includes(subcommand ?? "");
}

function allowedGh(args) {
  if (args[0] === "api")
    return !args.some((arg) => /^(-X|-f|-F|--method|--field|--raw-field|--input)/u.test(arg));

  return /^(pr (view|list|diff)|issue (view|list)|release (view|list)|search) /u.test(
    `${args.join(" ")} `,
  );
}

/** One command per pipe segment; `sort` and `uniq` write to a file they are given, so only flags may follow them. */
export function allowedCommand(command) {
  if (/[;&`$<>()\n\\]/u.test(command)) return false;

  return command.split("|").every((segment) => {
    const [program, ...args] = segment.trim().split(/\s+/u);

    if (program === "git") return allowedGit(args);

    if (program === "gh") return allowedGh(args);

    if (program === "rg") return !args.some((arg) => arg.startsWith("--pre"));

    if (program === "sort" || program === "uniq")
      return args.every((arg) => arg.startsWith("-") && !/^(-o|--output)/u.test(arg));

    return ["grep", "head", "tail", "wc", "cut"].includes(program ?? "");
  });
}

function allowedCall(toolClass, args) {
  if (toolClass.kind === "read" || toolClass.kind === "list") return true;

  return (
    toolClass.kind === "shell" && args?.background !== true && allowedCommand(toolClass.command)
  );
}

export default {
  id: AGENT,
  contribute: {
    agents: [
      {
        id: AGENT,
        description: "Writes release notes from git history without changing anything.",
        mode: "primary",
        tools: ["read", "list", "bash"],
      },
    ],
  },
  hooks: {
    before_tool: {
      order: -1,
      run: (call) =>
        allowedCall(call.class, call.args)
          ? { action: "continue" }
          : { action: "reject", reason: DENIED },
    },
  },
  approve: async (call) =>
    allowedCall(call.class, null) ? { kind: "allow" } : { kind: "deny", reason: DENIED },
};
