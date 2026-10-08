"use client";

import { useEffect, useRef, useState } from "react";

export type Client = "terminal" | "desktop" | "mobile";

export interface ToolCall {
  verb: "Read" | "Edited" | "Ran";
  subject: string;
  file: string;
  note: string;
  added?: number;
}

export interface Turn {
  id: number;
  text: string;
  from: Client;
  seenBy: readonly Client[];
  phase: "queued" | "working" | "done";
  tools: readonly ToolCall[];
  reply: string;
  seconds: number;
}

export const LABELS = { terminal: "Terminal", desktop: "Desktop", mobile: "Mobile" } as const;

export const SCRIPTED_PROMPT = "Add a test for runs written by 0.0.8";

const TEST_FILE = "packages/core/test/kernel/store.test.ts";

const SCRIPTED = {
  tools: [
    { verb: "Read", subject: TEST_FILE, file: "store.test.ts", note: "424 lines · ctrl+o expand" },
    { verb: "Edited", subject: TEST_FILE, file: "store.test.ts", note: "+31", added: 31 },
    {
      verb: "Ran",
      subject: "pnpm --dir packages/core test",
      file: "pnpm --dir packages/core test",
      note: "4.6s",
    },
  ],
  reply:
    "Added a test that opens a run written by 0.0.8 and checks that it migrates. The core tests pass.",
} as const satisfies { tools: readonly ToolCall[]; reply: string };

const UNSCRIPTED = {
  tools: [],
  reply: "This preview has no model behind it. Your message still reached all three clients.",
} as const satisfies { tools: readonly ToolCall[]; reply: string };

/*
 * The order a message reaches the others. Terminal and desktop share the
 * workspace's store; the phone reaches the desktop through Nyte Connect.
 */
const ROUTES: Record<Client, readonly (readonly Client[])[]> = {
  terminal: [["desktop"], ["mobile"]],
  desktop: [["terminal", "mobile"]],
  mobile: [["desktop"], ["terminal"]],
};

const HOP_MS = 420;

export interface Links {
  arrive: (client: Client) => void;
  reduced: () => boolean;
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function list(names: readonly string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : (names[0] ?? "");
}

/*
 * One session seen by three clients. A message shows at once where it was
 * typed, then reaches the others in turn; the reply lands everywhere.
 */
export function useSession(links: Links) {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const lifetime = useRef<AbortController>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  const update = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));

  const deliver = async (id: number, from: Client, signal: AbortSignal) => {
    const reached: Client[] = [];
    for (const hop of ROUTES[from]) {
      await pause(links.reduced() ? 0 : HOP_MS, signal);
      for (const client of hop) {
        reached.push(client);
        links.arrive(client);
      }
      update(id, (turn) => ({ ...turn, seenBy: [...turn.seenBy, ...hop] }));
    }
    setAnnouncement(`Delivered to ${list(reached.map((client) => LABELS[client]))}.`);
  };

  const respond = async (id: number, text: string, signal: AbortSignal) => {
    const script =
      text.trim().toLowerCase() === SCRIPTED_PROMPT.toLowerCase() ? SCRIPTED : UNSCRIPTED;
    const step = links.reduced() ? 0 : 1;
    const started = performance.now();

    update(id, (turn) => ({ ...turn, phase: "working" }));
    await pause(600, signal);

    for (const tool of script.tools) {
      update(id, (turn) => ({ ...turn, tools: [...turn.tools, tool] }));
      await pause(480, signal);
    }

    const words = script.reply.split(" ");
    for (let count = 1; count <= words.length; count += 1) {
      update(id, (turn) => ({ ...turn, reply: words.slice(0, count).join(" ") }));
      await pause(42 * step, signal);
    }

    update(id, (turn) => ({
      ...turn,
      phase: "done",
      seconds: (performance.now() - started) / 1000,
    }));
  };

  const send = (from: Client, text: string) => {
    const signal = lifetime.current?.signal;
    if (!signal) return;
    const id = nextId.current;
    nextId.current += 1;

    setTurns((all) => [
      ...all,
      { id, text, from, seenBy: [from], phase: "queued", tools: [], reply: "", seconds: 0 },
    ]);

    const delivered = deliver(id, from, signal).catch(() => undefined);
    queue.current = queue.current
      .then(async () => {
        await delivered;
        await respond(id, text, signal);
      })
      .catch(() => undefined);
  };

  return {
    turns,
    announcement,
    busy: turns.some((turn) => turn.phase !== "done"),
    send,
  };
}
