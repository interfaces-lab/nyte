export interface Harness {
  name: string;
  by: string;
  href: string;
  logo: string;
  modality?: "web";
}

export const HARNESSES = [
  {
    name: "Claude Code",
    by: "Anthropic",
    href: "https://code.claude.com/docs/en/overview",
    logo: "claude",
  },
  {
    name: "Codex CLI",
    by: "OpenAI",
    href: "https://developers.openai.com/codex/cli",
    logo: "codex",
  },
  { name: "Pi", by: "Earendil", href: "https://pi.dev/", logo: "pi" },
  { name: "Amp", by: "Amp", href: "https://ampcode.com/", logo: "amp" },
  {
    name: "Factory Droid",
    by: "Factory",
    href: "https://docs.factory.ai/cli/reference/cli-reference",
    logo: "factory",
  },
  { name: "Capy", by: "Capy", href: "https://capy.ai/", logo: "capy", modality: "web" },
  {
    name: "Cursor CLI",
    by: "Cursor",
    href: "https://cursor.com/docs/cli/overview",
    logo: "cursor",
  },
  { name: "OpenCode", by: "Anomaly", href: "https://opencode.ai/", logo: "opencode" },
] as const satisfies readonly Harness[];

export function harnessMeta(harness: Harness): string {
  return harness.modality ? `${harness.by} · ${harness.modality} agent` : harness.by;
}
