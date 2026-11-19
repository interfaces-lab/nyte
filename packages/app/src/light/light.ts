import { useSyncExternalStore } from "react";
import { SpanType } from "@nyte-ai/plugin/design/board-protocol";
import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const SubjectType = Type.Union([
  Type.Object({ kind: Type.Literal("file"), path: Type.String() }),
  Type.Object({ kind: Type.Literal("span"), ...SpanType.properties }),
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

const ActorType = Type.Object({
  kind: Type.Literal("agent"),
  session: idSchema<"session">(),
});

export type Actor = Static<typeof ActorType>;

const AgentLightType = Type.Object({
  subject: SubjectType,
  actor: ActorType,
  at: Type.Number(),
});

export type AgentLight = Static<typeof AgentLightType>;

/** The one selection every window shows, and what agents changed in the last moments. */
export interface Lights {
  readonly you: Light | null;
  readonly agents: readonly AgentLight[];
}

const MessageType = Type.Union([
  Type.Object({ kind: Type.Literal("you"), you: Type.Union([LightType, Type.Null()]) }),
  Type.Object({ kind: Type.Literal("agents"), agents: Type.Array(AgentLightType) }),
  Type.Object({ kind: Type.Literal("ask") }),
]);

const AGENT_MS = 4_000;

/** This window, among the windows that share the light. */
export const HERE = crypto.randomUUID();

const channel = new BroadcastChannel("nyte:light:v1");

const listeners = new Set<() => void>();

let lights: Lights = { you: null, agents: [] };

function show(next: Lights): void {
  lights = next;

  for (const listener of listeners) listener();
}

function showYou(you: Light | null): void {
  show({ you, agents: lights.agents });
  channel.postMessage({ kind: "you", you });
}

function addAgents(incoming: readonly AgentLight[]): readonly AgentLight[] {
  const now = Date.now();

  const fresh = incoming.filter(
    (light, index) =>
      light.at + AGENT_MS > now &&
      ![...lights.agents, ...incoming.slice(0, index)].some(
        (known) =>
          Value.Equal(known.subject, light.subject) && Value.Equal(known.actor, light.actor),
      ),
  );

  if (fresh.length === 0) return fresh;
  show({ you: lights.you, agents: [...lights.agents, ...fresh] });

  for (const light of fresh)
    setTimeout(
      () => show({ you: lights.you, agents: lights.agents.filter((other) => other !== light) }),
      light.at + AGENT_MS - now,
    );

  return fresh;
}

channel.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;

  if (!Value.Check(MessageType, message)) return;

  switch (message.kind) {
    case "ask":
      if (lights.you !== null) channel.postMessage({ kind: "you", you: lights.you });

      if (lights.agents.length > 0) channel.postMessage({ kind: "agents", agents: lights.agents });

      return;
    case "you":
      show({ you: message.you, agents: lights.agents });

      return;
    case "agents":
      addAgents(message.agents);

      return;
    default: {
      const exhaustive: never = message;

      return exhaustive;
    }
  }
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
  showYou(subject === null ? null : { subject, window: HERE, from, at: Date.now() });
}

/** Lights what an agent changed, for a moment, in every window. A second report of the same change, from another window that saw it, is the same light. */
export function shineAgent(subject: Subject, actor: Actor): void {
  const added = addAgents([{ subject, actor, at: Date.now() }]);

  if (added.length > 0) channel.postMessage({ kind: "agents", agents: added });
}

/**
 * Keeps the person's light on what they selected while its file is edited under it: typing a button's words on the
 * board, or moving a frame, changes the length of the very element the light is on, and a light left at the old
 * offsets would be on half of that element and the start of the next.
 */
export function carryLight(
  path: string,
  change: { readonly start: number; readonly end: number; readonly text: string },
): void {
  const you = lights.you;

  if (
    you === null ||
    you.window !== HERE ||
    you.subject.kind !== "span" ||
    you.subject.path !== path
  )
    return;
  const span = you.subject;
  const grown = change.text.length - (change.end - change.start);

  if (change.start >= span.end) return;

  if (change.end <= span.start) {
    if (grown !== 0)
      showYou({
        ...you,
        subject: { ...span, start: span.start + grown, end: span.end + grown },
      });

    return;
  }

  if (change.start < span.start || change.end > span.end) {
    showYou(null);

    return;
  }

  if (grown !== 0) showYou({ ...you, subject: { ...span, end: span.end + grown } });
}
