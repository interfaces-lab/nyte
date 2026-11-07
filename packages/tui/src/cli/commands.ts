/** Root help groups commands by task, in this order. Each heading replaces `Commands:`. */
export type HelpGroup = "Chat" | "Sign-in" | "Tools" | "Host" | "Maintenance";

export interface OptionSpec {
  /** Long name without dashes. */
  readonly name: string;
  readonly short?: string;
  /** Value hint such as `<URL>`; absent for a switch. */
  readonly value?: string;
  /** Imperative fragment, no period. Includes `(default: X)` when there is one. */
  readonly summary: string;
  /** May be given more than once; `parseOptions` keeps every value in order. Otherwise a repeat fails. */
  readonly repeatable?: boolean;
}

export interface Example {
  readonly label: string;
  readonly argv: readonly string[];
}

/** One action of a group, with its own help page: `nyte mcp add --help`. */
export interface ActionSpec {
  readonly name: string;
  /** Imperative, no period. */
  readonly summary: string;
  /** After `nyte <group> <name> `: `<NAME> [options]`. */
  readonly usage: string;
  /** What the group runs with no action word, such as `nyte account` linking this machine. One per group at most. */
  readonly default?: true;
  /** Taken by this action only, on top of the group's `options`. */
  readonly options?: readonly OptionSpec[];
  readonly examples?: readonly Example[];
  readonly notes?: readonly string[];
}

export interface CommandSpec {
  readonly name: string;
  /** Imperative, no period: `Manage MCP servers`. */
  readonly summary: string;
  /** After `nyte <name> `: `<command> [options]`. */
  readonly usage: string;
  readonly group: HelpGroup;
  /** For groups: the actions. A group with no `default` action shows its help when run with no action. */
  readonly subcommands?: readonly ActionSpec[];
  /** A command's options; for a group, the ones every action takes. */
  readonly options?: readonly OptionSpec[];
  readonly examples?: readonly Example[];
  /** Material behavior only: streams, stdin, side effects, waiting. */
  readonly notes?: readonly string[];
}

const HOST_URL = {
  name: "host-url",
  value: "<URL>",
  summary: "Ask this running host; its token comes from NYTE_HOST_TOKEN",
} as const;

const MCP_LOCAL = {
  name: "local",
  short: "l",
  summary: "Change this folder's .nyte/mcp.json",
} as const;

const SKILL_AGENT = {
  name: "agent",
  value: "<AGENT>",
  summary: "Choose claude, codex or all (default: all)",
} as const;

/** The one list of commands. Dispatch, help, suggestions and the handler table in the entry all derive from it. */
export const COMMANDS = [
  {
    name: "trust",
    summary: "Trust a folder's project files",
    usage: "[<FOLDER>] [options]",
    group: "Chat",
    options: [
      { name: "json", summary: "Print the folder and the outcome as one JSON document" },
      { name: "yes", short: "y", summary: "Trust without asking; needed without a terminal" },
    ],
    examples: [
      { label: "Trust this folder", argv: ["nyte", "trust"] },
      {
        label: "Trust a folder from a script, after a human approves",
        argv: ["nyte", "trust", "<FOLDER>", "--yes"],
      },
    ],
    notes: [
      "Trusted project files load in the folder's chats and can run code on this machine: plugins in .nyte/plugins, skills in .nyte/skills and .agents/skills, .nyte/SYSTEM.md, .nyte/APPEND_SYSTEM.md and .nyte/mcp.json. Folders below it without their own decision follow it.",
      "FOLDER defaults to this folder. On a terminal, lists the project files and asks first. Without one, it needs --yes.",
      "Starts a host when none runs and opens the folder in it. Chats already open reload with the change.",
      "Your home folder can't be trusted: its .nyte files are your user files.",
      'The receipt goes to stderr. With stdout redirected or without a terminal, prints the folder\'s path there. --json prints {"folder":{"path","trusted","decision","projectSources"},"outcome"} instead, where outcome is trusted or unchanged.',
    ],
  },
  {
    name: "untrust",
    summary: "Stop loading a folder's project files",
    usage: "[<FOLDER>] [options]",
    group: "Chat",
    options: [{ name: "json", summary: "Print the folder and the outcome as one JSON document" }],
    examples: [{ label: "Stop loading this folder's project files", argv: ["nyte", "untrust"] }],
    notes: [
      "Saves that the folder's skills, prompts, plugins and MCP servers don't load, even when the Project trust setting or a folder above would trust it. FOLDER defaults to this folder.",
      "Starts a host when none runs and opens the folder in it. Chats already open reload with the change.",
      'The receipt goes to stderr. With stdout redirected or without a terminal, prints the folder\'s path there. --json prints {"folder":{"path","trusted","decision","projectSources"},"outcome"} instead, where outcome is untrusted or unchanged.',
    ],
  },
  {
    name: "login",
    summary: "Sign in to a model provider",
    usage: "[<PROVIDER>] [options]",
    group: "Sign-in",
    options: [
      {
        name: "label",
        value: "<LABEL>",
        summary: "Name this login when the provider has one saved",
      },
      { name: "method", value: "<METHOD>", summary: "Sign in with oauth or api_key" },
      { name: "key", value: "-", summary: "Read the API key from stdin, without a terminal" },
      { name: "no-open", summary: "Print the sign-in link instead of opening a browser here" },
    ],
    examples: [
      {
        label: "Sign in to OpenAI with an API key",
        argv: ["nyte", "login", "openai", "--method", "api_key"],
      },
      {
        label: "Sign in to Anthropic with a key piped on stdin",
        argv: ["nyte", "login", "anthropic", "--key", "-"],
      },
      {
        label: "Sign in from a browser on another machine",
        argv: ["nyte", "login", "anthropic", "--method", "oauth", "--no-open"],
      },
    ],
    notes: [
      "Prompts need an interactive terminal on stdin and stderr. --key - needs none: it takes a provider and reads the key from piped stdin, dropping one trailing newline.",
      "The key is never an argument, so it stays out of shell history and process lists.",
      "Without a provider, asks which one. Without --method, asks how when the provider offers more than one way.",
      "--no-open, or a session over SSH, uses the provider's copy-code or device-code sign-in, for a browser on any device.",
      "The host stops waiting after 10 minutes if the sign-in isn't finished.",
      "Prompts, sign-in links and the receipt go to stderr. With stdout redirected or with --key -, prints the provider ID there.",
    ],
  },
  {
    name: "logout",
    summary: "Remove a provider's saved login",
    usage: "[<PROVIDER>]",
    group: "Sign-in",
    examples: [{ label: "Remove OpenAI's saved login", argv: ["nyte", "logout", "openai"] }],
    notes: [
      "Removes the active saved login. The provider's other saved logins stay, not active.",
      "Without a provider, picks the one provider with a saved login, or asks which when there are more. Without an interactive terminal, name the provider.",
      "Credentials from the environment or other tools stay active; the receipt says so.",
      "The receipt goes to stderr. With stdout redirected, prints the provider ID there.",
    ],
  },
  {
    name: "status",
    summary: "List provider credentials",
    usage: "[options]",
    group: "Sign-in",
    options: [{ name: "json", summary: "Print the credentials as one JSON document" }],
    examples: [{ label: "Print credentials as JSON", argv: ["nyte", "status", "--json"] }],
    notes: [
      "Lists every credential the running host sees, saved by nyte login or from the environment.",
      "Waits up to 5 seconds for a host that just started to check its credentials. A check still running then shows as checking.",
      'Reads the running host and starts none. --json prints {"credentials":[{"provider","credential"}]}.',
    ],
  },
  {
    name: "account",
    summary: "Link this machine to your Nyte account",
    usage: "[<command>] [options]",
    group: "Sign-in",
    subcommands: [
      {
        name: "link",
        summary: "Link this machine and wait for your approval",
        usage: "[options]",
        default: true,
        options: [{ name: "no-open", summary: "Print the approval URL without opening a browser" }],
        examples: [
          { label: "Link this machine", argv: ["nyte", "account"] },
          {
            label: "Approve from a browser on another device",
            argv: ["nyte", "account", "--no-open"],
          },
        ],
        notes: [
          "Opens the approval page, prints its URL and code on stderr, waits until you approve and exits. Needs an interactive terminal.",
          "Once linked, this machine is shared while a Nyte host runs, after nyte account exits.",
        ],
      },
      {
        name: "status",
        summary: "Print the link and its devices",
        usage: "[options]",
        options: [{ name: "json", summary: "Print the link as one JSON document" }],
        examples: [
          { label: "Print the link as JSON", argv: ["nyte", "account", "status", "--json"] },
        ],
        notes: ["Needs a running host and starts none."],
      },
      {
        name: "unlink",
        summary: "Remove this machine from your account",
        usage: "[options]",
        options: [
          { name: "yes", short: "y", summary: "Unlink without asking; needed without a terminal" },
        ],
        examples: [{ label: "Unlink from a script", argv: ["nyte", "account", "unlink", "--yes"] }],
        notes: ["Asks first on a terminal. Without one, it needs --yes."],
      },
    ],
    notes: ["Separate from nyte login, which signs in to a model provider."],
  },
  {
    name: "mcp",
    summary: "Manage MCP servers",
    usage: "<command> [options]",
    group: "Tools",
    subcommands: [
      {
        name: "add",
        summary: "Add a server over HTTP with --url, or over stdio after --",
        usage: "<NAME> [options] [-- <COMMAND> [<ARG>]...]",
        options: [
          {
            name: "bearer-token-env-var",
            value: "<NAME>",
            summary: "Send the token in this variable as a bearer token",
          },
          { name: "cwd", value: "<DIR>", summary: "Run a stdio server in this folder" },
          { name: "description", value: "<TEXT>", summary: "Describe the server to the agent" },
          {
            name: "env",
            value: "<KEY=VALUE>",
            summary: "Set a variable for a stdio server",
            repeatable: true,
          },
          {
            name: "exposure",
            value: "<MODE>",
            summary: "Set how the agent sees the server's tools",
          },
          { name: "force", summary: "Replace a server with the same name" },
          {
            name: "header",
            value: "<KEY=VALUE>",
            summary: "Send this HTTP header",
            repeatable: true,
          },
          MCP_LOCAL,
          {
            name: "oauth-callback-port",
            value: "<PORT>",
            summary: "Receive the OAuth redirect here",
          },
          { name: "oauth-client-id", value: "<ID>", summary: "Sign in as this OAuth client" },
          {
            name: "oauth-client-name",
            value: "<NAME>",
            summary: "Register the OAuth client by name",
          },
          {
            name: "oauth-client-secret",
            value: "<SECRET>",
            summary: "Use this OAuth client secret",
          },
          { name: "url", value: "<URL>", summary: "Connect over streamable HTTP at this URL" },
        ],
        examples: [
          {
            label: "Add a streamable HTTP server",
            argv: ["nyte", "mcp", "add", "docs", "--url", "https://example.com/mcp"],
          },
          {
            label: "Add a server run over stdio",
            argv: [
              "nyte",
              "mcp",
              "add",
              "files",
              "--",
              "npx",
              "-y",
              "@modelcontextprotocol/server-filesystem",
              ".",
            ],
          },
        ],
        notes: [
          "Changes ~/.nyte/mcp.json, or with --local this folder's .nyte/mcp.json, which needs the folder to be trusted.",
          "Fails when the name is taken in that mcp.json; --force replaces the entry.",
          "${VAR} in env, headers and secrets comes from the environment nyte runs in, so export it before nyte starts. --bearer-token-env-var keeps a token out of the file.",
          "--exposure takes direct, deferred, codemode, codemode-deferred or hidden.",
        ],
      },
      {
        name: "remove",
        summary: "Remove a server; its sign-in stays",
        usage: "<NAME> [options]",
        options: [MCP_LOCAL],
        examples: [
          {
            label: "Remove a server from this folder",
            argv: ["nyte", "mcp", "remove", "<NAME>", "--local"],
          },
        ],
        notes: [
          "Changes ~/.nyte/mcp.json, or with --local this folder's .nyte/mcp.json, which needs the folder to be trusted.",
        ],
      },
      {
        name: "list",
        summary: "Connect every server and print its state",
        usage: "[options]",
        options: [{ name: "json", summary: "Print the servers as one JSON document" }],
        examples: [{ label: "Print the servers as JSON", argv: ["nyte", "mcp", "list", "--json"] }],
        notes: [
          "Reads the running host's servers and starts no host. In a folder Nyte hasn't opened, it lists only your user servers.",
          "Exits 1 when an entry is invalid or an enabled server isn't connected.",
        ],
      },
      {
        name: "login",
        summary: "Sign in to a server with OAuth",
        usage: "[<NAME>]",
        examples: [{ label: "Sign in to a server", argv: ["nyte", "mcp", "login", "<NAME>"] }],
        notes: [
          "Without a name, asks which server; that needs an interactive terminal.",
          "Over SSH, paste the URL the browser ends on.",
        ],
      },
      {
        name: "logout",
        summary: "Delete a server's stored sign-in",
        usage: "<NAME>",
        examples: [{ label: "Sign out of a server", argv: ["nyte", "mcp", "logout", "<NAME>"] }],
      },
    ],
    notes: [
      "Receipts go to stderr. add, remove, login and logout print the server's name on stdout when stdout isn't a terminal.",
    ],
  },
  {
    name: "api",
    summary: "List, describe or call a host's operations",
    usage: "<command> [options]",
    group: "Tools",
    subcommands: [
      {
        name: "list",
        summary: "Print every operation with its summary",
        usage: "[options]",
        examples: [
          { label: "Print every operation as JSON", argv: ["nyte", "api", "list", "--json"] },
        ],
        notes: ["Without --host-url, reads this build's operations and starts no host."],
      },
      {
        name: "describe",
        summary: "Print an operation's access and JSON Schemas",
        usage: "<OPERATION> [options]",
        examples: [
          { label: "Describe one operation", argv: ["nyte", "api", "describe", "head.send"] },
        ],
        notes: ["Without --host-url, reads this build's operations and starts no host."],
      },
      {
        name: "call",
        summary: "Call an operation on a running host",
        usage: "<OPERATION> [<INPUT>] [options]",
        examples: [
          { label: "Call an operation", argv: ["nyte", "api", "call", "sessions.list", "{}"] },
        ],
        notes: [
          "Takes its JSON input from the argument, else from piped stdin ({} when empty). With a terminal on stdin, pass the argument.",
          "Needs a running host and never starts one. The answer goes to stdout as JSON.",
          "A failed call exits 2 when the host rejects the input and 1 otherwise. With --json, the error's data is the host's wire error.",
        ],
      },
    ],
    options: [
      HOST_URL,
      {
        name: "json",
        summary: "Print JSON, and a failure as JSON on stderr",
      },
    ],
  },
  {
    name: "skill",
    summary: "Teach Claude Code and Codex to use nyte",
    usage: "<command> [options]",
    group: "Tools",
    subcommands: [
      {
        name: "setup",
        summary: "Install the nyte skill and a session-start hook",
        usage: "[options]",
        options: [SKILL_AGENT],
        examples: [
          { label: "Set up every agent installed here", argv: ["nyte", "skill", "setup"] },
          {
            label: "Set up Claude Code only",
            argv: ["nyte", "skill", "setup", "--agent", "claude"],
          },
        ],
        notes: [
          "Writes <CONFIG>/skills/nyte/SKILL.md and adds a session-start hook running nyte skill hook to Claude Code's settings.json and Codex's hooks.json. Other keys and hooks stay as they were.",
          "With --agent all, sets up each agent whose config folder exists.",
          "Checks every file before it writes any. The receipt on stderr lists each file. Without an interactive terminal, the files that changed also print on stdout, one per line.",
          "Running it again changes nothing. Codex runs a new hook only after you approve it with /hooks.",
        ],
      },
      {
        name: "status",
        summary: "Print each agent's skill and hook",
        usage: "[options]",
        options: [{ name: "json", summary: "Print each agent's state as one JSON document" }],
        examples: [
          {
            label: "Print each agent's state as JSON",
            argv: ["nyte", "skill", "status", "--json"],
          },
        ],
      },
      {
        name: "remove",
        summary: "Remove only what setup installed",
        usage: "[options]",
        options: [SKILL_AGENT],
        examples: [
          {
            label: "Remove the skill from Codex only",
            argv: ["nyte", "skill", "remove", "--agent", "codex"],
          },
        ],
        notes: ["With --agent all, removes from both agents."],
      },
      {
        name: "hook",
        summary: "Print the context the session-start hook adds",
        usage: "",
        notes: [
          "The hook setup installs runs it at session start. It checks for a running host for up to 2 s and changes nothing.",
        ],
      },
    ],
    notes: [
      "Config folders are ~/.claude and ~/.codex, or CLAUDE_CONFIG_DIR and CODEX_HOME when set.",
    ],
  },
  {
    name: "host",
    summary: "Serve your chats for other clients to attach to",
    usage: "[options]",
    group: "Host",
    options: [
      { name: "json", summary: "Print the listening line as JSON" },
      {
        name: "log",
        summary: "Write the listening line and the stopping error to ~/.nyte/logs/host.log",
      },
    ],
    examples: [
      { label: "Serve and print where it listens as JSON", argv: ["nyte", "host", "--json"] },
    ],
    notes: [
      "Serves on 127.0.0.1 and on ~/.nyte/host.sock (mode 0600), where the Nyte app connects, until stopped.",
      "Writes the URL, token and pid to ~/.nyte/host.json (mode 0600) and removes it on exit.",
      'Prints the URL on stdout, or with --json one {"type":"listening","url","endpoint","socket","pid"} line, where endpoint is the host.json path. Where it listens goes to stderr.',
      "One host runs per home. A second exits 1 and names the first one's pid and URL.",
      "SIGINT, SIGTERM and SIGHUP stop it with exit 130, 143 or 129.",
      "To attach, run NYTE_HOST_TOKEN=<TOKEN> nyte --host-url <URL> with the token from host.json.",
    ],
  },
  {
    name: "events",
    summary: "Print a running host's events as JSON lines",
    usage: "[options]",
    group: "Host",
    options: [
      HOST_URL,
      {
        name: "json",
        summary: "Print a warning or a failure as JSON on stderr",
      },
      {
        name: "scope",
        value: "<SCOPE>",
        summary: "Follow host, session/<ID> or client/<ID> (default: host)",
        repeatable: true,
      },
      {
        name: "timeout",
        value: "<DURATION>",
        summary: "Stop after this long, such as 30s or 10m (default: until stopped)",
      },
    ],
    examples: [
      {
        label: "Follow the host and one session",
        argv: ["nyte", "events", "--scope", "host", "--scope", "session/<SESSION_ID>"],
      },
      { label: "Follow for ten minutes in CI", argv: ["nyte", "events", "--timeout", "10m"] },
    ],
    notes: [
      "Prints until Ctrl+C, a signal, a closed stdout or --timeout. Repeat --scope to follow more than one. In CI, --timeout is required.",
      "Needs a running host and never starts one. Without --host-url, it uses the host this home runs.",
      "A lost connection retries every 1 s to 30 s and gives up after 5 minutes. Once back, it warns that events sent meanwhile were missed.",
      "Ctrl+C exits 130, SIGTERM 143, --timeout 0, giving up 1.",
    ],
  },
  {
    name: "update",
    summary: "Install a newer nyte, switch channel or refresh the model catalog",
    usage: "[<VERSION> | stable | nightly] [options]",
    group: "Maintenance",
    options: [
      { name: "check", summary: "Check for an update without installing it" },
      { name: "models", summary: "Refresh the model catalog without updating nyte" },
      {
        name: "yes",
        short: "y",
        summary: "Install an older version without asking; needed without a terminal",
      },
    ],
    examples: [
      { label: "Install the newest release", argv: ["nyte", "update"] },
      { label: "Switch to nightly builds", argv: ["nyte", "update", "nightly"] },
      { label: "Check for an update", argv: ["nyte", "update", "--check"] },
    ],
    notes: [
      "With no target, installs the newest release on the channel updates follow, when it's newer than this build. The channel is saved in ~/.nyte/updates.json; without it, updates follow this build's channel.",
      "stable or nightly switches the channel; it never installs an older release. It installs the channel's newest release only when that's newer than this build, and otherwise waits for one that is.",
      "A version installs exactly that release, and later updates follow its channel. Only a version can go back to an older release: it asks first, and without a terminal it needs --yes.",
      "Choose one of a version, a channel, --check or --models.",
      "Progress and the receipt go to stderr. With stdout redirected, prints the installed version, or the channel a switch saved, there. --check prints its answer on stdout.",
    ],
  },
  {
    name: "doctor",
    summary: "Check this install and print what to fix",
    usage: "[options]",
    group: "Maintenance",
    options: [{ name: "json", summary: "Print the report as one JSON document" }],
    examples: [{ label: "Check this install", argv: ["nyte", "doctor"] }],
    notes: [
      "Checks the binary, PATH, updates, ~/.nyte, secret file modes, the host, provider credentials, the terminal and recent crashes.",
      "Changes nothing and starts no host. Without a running host it says so and leaves provider credentials unchecked.",
      "Reads ~/.nyte/host.json to reach the running host; the other secret files it only checks with stat.",
      "Every problem ends with the fix. Exits 1 when a check fails.",
    ],
  },
  {
    name: "triage",
    summary: "Start an agent on doctor's report and logs",
    usage: "[options] [<PROBLEM>]",
    group: "Maintenance",
    options: [{ name: "agent", value: "<AGENT>", summary: "Choose nyte, claude or codex" }],
    examples: [
      {
        label: "Describe what went wrong",
        argv: ["nyte", "triage", "the desktop app shows a blank window after updating"],
      },
    ],
    notes: [
      "Shows what it would collect from nyte doctor's report and redacted logs, then asks before it writes ~/.nyte/triage/<TIME>/ and starts an agent there with a playbook to find the cause.",
      "The agent is nyte when a provider has a credential, otherwise Claude Code, then Codex. With no host running, nyte comes last.",
      "If the agent writes an issue, triage prints all of it and creates it with gh only after you answer y.",
      "Never reads auth.json, identity.key, connect.json or other key files.",
      "Needs an interactive terminal. Declining or Ctrl+C at a prompt exits 130; otherwise it exits with the agent's code, or gh's after posting.",
    ],
  },
] as const satisfies readonly CommandSpec[];

export type CommandName = (typeof COMMANDS)[number]["name"];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}
