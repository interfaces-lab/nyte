import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const SubjectType = Type.Union([
  Type.Object({ kind: Type.Literal("file"), path: Type.String() }),
  Type.Object({
    kind: Type.Literal("span"),
    path: Type.String(),
    start: Type.Number(),
    end: Type.Number(),
  }),
]);

/** What a light is on: a file, or a range of one. Paths are absolute, so every window means the same file. */
export type Subject = Static<typeof SubjectType>;

const LightType = Type.Object({
  subject: SubjectType,
  window: Type.String(),
  from: Type.String(),
  at: Type.Number(),
});

export type Light = Static<typeof LightType>;

const LightsType = Type.Object({
  you: Type.Union([LightType, Type.Null()]),
  agents: Type.Array(LightType),
});

/** The one selection every window shows, and what agents changed in the last moments. */
export type Lights = Static<typeof LightsType>;

const MessageType = Type.Union([
  Type.Object({ kind: Type.Literal("lights"), lights: LightsType }),
  Type.Object({ kind: Type.Literal("ask") }),
]);

const AGENT_MS = 4_000;

/** This window, among the windows that share the light. */
export const HERE = crypto.randomUUID();

const channel = new BroadcastChannel("nyte:light:v1");

const listeners = new Set<() => void>();

let lights: Lights = { you: null, agents: [] };

function show(next: Lights, tell: boolean): void {
  lights = next;

  if (tell) channel.postMessage({ kind: "lights", lights });

  for (const listener of listeners) listener();
}

channel.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;

  if (!Value.Check(MessageType, message)) return;

  if (message.kind === "ask") {
    if (lights.you !== null || lights.agents.length > 0)
      channel.postMessage({ kind: "lights", lights });

    return;
  }

  show(message.lights, false);
});

channel.postMessage({ kind: "ask" });

export function currentLights(): Lights {
  return lights;
}

export function watchLights(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** What a component shows of the lights; it renders again only when that changes, so `select` returns a primitive. */
export function useLights<Shown>(select: (lights: Lights) => Shown): Shown {
  return useSyncExternalStore(watchLights, () => select(lights));
}

/** Moves the person's light, from the surface named, in every window; `null` puts it out. */
export function shine(subject: Subject | null, from: string): void {
  show(
    {
      you: subject === null ? null : { subject, window: HERE, from, at: Date.now() },
      agents: lights.agents,
    },
    true,
  );
}

/** Lights what an agent changed, for a moment, in every window. A second report of the same change, from another window that saw it, is the same light. */
export function shineAgent(subject: Subject): void {
  const known = lights.agents.some((light) => Value.Equal(light.subject, subject));

  if (known) return;
  const light: Light = { subject, window: HERE, from: "agent", at: Date.now() };

  show({ you: lights.you, agents: [...lights.agents, light] }, true);
  setTimeout(
    () => show({ you: lights.you, agents: lights.agents.filter((other) => other !== light) }, true),
    AGENT_MS,
  );
}

/**
 * Keeps the person's light on what they selected while its file is edited under it: typing a button's words on the
 * board, or moving a frame, changes the length of the very element the light is on, and a light left at the old
 * offsets would be on half of that element and the start of the next.
 */
export function carryLight(path: string, start: number, end: number, inserted: number): void {
  const you = lights.you;

  if (you === null || you.subject.kind !== "span" || you.subject.path !== path) return;
  const grown = inserted - (end - start);
  const from = you.subject.start;
  const to = you.subject.end;

  if (to <= start || grown === 0) return;

  show(
    {
      you: {
        ...you,
        subject: {
          kind: "span",
          path,
          start: from >= end ? from + grown : Math.min(from, start),
          end: to >= end ? to + grown : start + inserted,
        },
      },
      agents: lights.agents,
    },
    true,
  );
}
