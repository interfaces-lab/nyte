export const fps = 30;

export const durationInFrames = 80 * fps;

export const scenes = [
  { kind: "title", from: 0, until: 7, title: "Nyte Core", detail: "A durable runtime for agents." },
  {
    kind: "execution",
    from: 7,
    until: 16,
    title: "Send work. Get a receipt.",
    detail: "A session owns the history and execution.",
  },
  {
    kind: "objects",
    from: 16,
    until: 25,
    title: "The work has a history.",
    detail: "Immutable objects. Atomic refs.",
  },
  {
    kind: "recovery",
    from: 25,
    until: 36,
    title: "A process can stop. The session can continue.",
    detail: "Recover from published state. Honor each tool’s replay policy.",
  },
  {
    kind: "branches",
    from: 36,
    until: 45,
    title: "Explore another direction. Keep the context.",
    detail: "Named heads share a history without discarding the original path.",
  },
  {
    kind: "parts",
    from: 45,
    until: 54,
    title: "A question is part of the state.",
    detail: "A tool can wait. A connected client can answer.",
  },
  {
    kind: "extensions",
    from: 54,
    until: 62,
    title: "Your models. Your tools. Your rules.",
    detail: "Plugins add behavior. Environments supply capabilities.",
  },
  {
    kind: "interfaces",
    from: 62,
    until: 70,
    title: "One SDK. Your interface.",
    detail: "The terminal, desktop and mobile clients use the same session model.",
  },
  {
    kind: "hosts",
    from: 70,
    until: 75,
    title: "Compose the host you need.",
    detail: "Storage and execution adapters for local, server and edge hosts.",
  },
  {
    kind: "end",
    from: 75,
    until: 80,
    title: "Nyte Core",
    detail: "Build agents that can continue.",
  },
] as const;

export type Scene = (typeof scenes)[number];

export const plateFrames = [165, 435, 615, 1005, 1260, 1530, 2055];

export const soundtrack = "music/introduction.mp3";
