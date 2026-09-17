import { readFileSync } from "node:fs";
import path from "node:path";

interface Part {
  name: string;
  role: string;
  /** Optional illustration from src/diagrams. */
  figure?: string;
}

const parts: readonly Part[] = [
  {
    name: "Schema",
    role: "Shared types for messages, models, and tools.",
    figure: "package-schema",
  },
  {
    name: "AI",
    role: "Connects to AI providers and streams their replies.",
    figure: "package-ai",
  },
  {
    name: "Core",
    role: "Runs agents and saves their conversations and work.",
    figure: "package-core",
  },
  {
    name: "UI",
    role: "Shared buttons, menus, dialogs, and other UI components.",
    figure: "package-ui",
  },
  {
    name: "Plugin",
    role: "Lets you add tools, commands, and custom agent behavior.",
    figure: "package-plugin",
  },
  {
    name: "Telemetry",
    role: "Hooks for tracking agent activity; recording is not implemented yet.",
    figure: "package-telemetry",
  },
  {
    name: "Terminal",
    role: "An app for working with agents in your terminal.",
    figure: "package-terminal",
  },
  {
    name: "Desktop",
    role: "A desktop app for working with agents.",
    figure: "package-desktop",
  },
  { name: "Protocol", role: "Defines the messages clients and servers exchange." },
  { name: "Server", role: "Makes Nyte available over HTTP." },
  { name: "Client", role: "Connects your app to a Nyte server." },
];

const DIAGRAMS = path.join(process.cwd(), "src", "diagrams");

/* Inlined, so the figure reads the page's --nyte-color-* tokens. */
function figure(name: string): string {
  return readFileSync(path.join(DIAGRAMS, `${name}.svg`), "utf8");
}

export function PackageWall() {
  return (
    <ul className="wall">
      {parts.map((entry) => (
        <li key={entry.name}>
          {entry.figure === undefined ? (
            <div className="fig" aria-hidden="true" />
          ) : (
            <div className="fig" dangerouslySetInnerHTML={{ __html: figure(entry.figure) }} />
          )}
          <div>
            <span className="n">{entry.name}</span>
            <span className="role">{entry.role}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
