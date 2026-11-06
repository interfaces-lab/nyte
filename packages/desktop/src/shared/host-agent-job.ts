import { basename } from "node:path";

export const DESKTOP_APP_IDS = {
  production: "ai.nyte.desktop",
  updateTest: "ai.nyte.desktop.update-test",
} as const;

export interface HostAgentJob {
  readonly label: string;
  readonly program: { readonly kind: "bundle" | "path"; readonly path: string };
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly log: string | null;
}

export function bundledHostAgentJob(input: {
  readonly appId: string;
  readonly executable: string;
}): HostAgentJob {
  return {
    label: `${input.appId}.host`,
    program: { kind: "bundle", path: `Contents/MacOS/${input.executable}` },
    arguments: [
      "-e",
      'const entry = require("node:path").join(process.resourcesPath, "app.asar", "out", "main", "nyte-host.js"); process.argv.splice(1, 0, entry); require(entry);',
      "--",
      "--log",
    ],
    environment: { ELECTRON_RUN_AS_NODE: "1" },
    log: null,
  };
}

const DEVELOPMENT_HOST_VARIABLES = [
  "NYTE_MODELS_URL",
  "NYTE_TRACE",
  "NYTE_DEV",
  "NYTE_SKIP_VERSION_CHECK",
] as const;

export function developmentHostAgentJob(input: {
  readonly label: string;
  readonly executable: string;
  readonly entry: string;
  readonly tailnet: string;
  readonly home: string;
  readonly nyteHome: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): HostAgentJob {
  const forwarded = DEVELOPMENT_HOST_VARIABLES.flatMap((name) => {
    const value = input.environment[name];

    return value === undefined || value === "" ? [] : [[name, value] as const];
  });

  return {
    label: input.label,
    program: { kind: "path", path: input.executable },
    arguments: [input.entry, "--tailnet", input.tailnet],
    environment: {
      ELECTRON_RUN_AS_NODE: "1",
      HOME: input.home,
      NYTE_HOME: input.nyteHome,
      ...Object.fromEntries(forwarded),
    },
    log: `${input.nyteHome}/logs/host.log`,
  };
}

export function hostAgentPlist(job: HostAgentJob): string {
  const argv0 = job.program.kind === "bundle" ? basename(job.program.path) : job.program.path;
  const environment = Object.entries(job.environment);

  const entries = [
    key("Label", text(job.label)),
    key(job.program.kind === "bundle" ? "BundleProgram" : "Program", text(job.program.path)),
    key(
      "ProgramArguments",
      `<array>${[argv0, ...job.arguments].map((argument) => text(argument)).join("")}</array>`,
    ),
    ...(environment.length === 0
      ? []
      : [
          key(
            "EnvironmentVariables",
            `<dict>${environment.map(([name, value]) => key(name, text(value))).join("")}</dict>`,
          ),
        ]),
    ...(job.log === null
      ? []
      : [key("StandardOutPath", text(job.log)), key("StandardErrorPath", text(job.log))]),
    key("KeepAlive", "<true/>"),
    key("RunAtLoad", "<true/>"),
    key("ProcessType", text("Interactive")),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${entries.join("")}</dict></plist>
`;
}

function key(name: string, value: string): string {
  return `<key>${escape(name)}</key>${value}`;
}

function text(value: string): string {
  return `<string>${escape(value)}</string>`;
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
