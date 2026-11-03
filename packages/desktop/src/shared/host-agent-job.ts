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

export function bundledHostAgentJob(appId: string): HostAgentJob {
  return {
    label: `${appId}.host`,
    program: { kind: "bundle", path: "Contents/Resources/nyte" },
    arguments: ["host", "--log"],
    environment: {},
    log: null,
  };
}

export function hostAgentPlist(job: HostAgentJob): string {
  const argv0 = job.program.kind === "bundle" ? "nyte" : job.program.path;
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
