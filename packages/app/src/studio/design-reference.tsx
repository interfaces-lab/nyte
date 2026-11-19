import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { currentLights, useLights } from "../light/light.ts";
import { ADD_TO_CHAT_LABEL, addToChat } from "../references/add-to-chat.ts";
import { parseDesign } from "./design-source.ts";
import type { DesignStore } from "./designs.ts";

export function AddDesignToChat(input: { readonly store: DesignStore }): ReactElement | null {
  const store = input.store;
  const selected = useLights((lights) => store.lights(lights).you?.subject.kind === "span");

  if (!selected) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      icon="paperclip"
      onClick={() => void addSelectionToChat(store)}
    >
      {ADD_TO_CHAT_LABEL}
    </Button>
  );
}

async function addSelectionToChat(store: DesignStore): Promise<void> {
  const subject = store.lights(currentLights()).you?.subject;

  if (subject?.kind !== "span") return;
  const text = store.read(subject.path);

  if (text === undefined) return;
  const source = await parseDesign(subject.path, text);

  const frame = source.frames.find(
    (found) => found.element.start <= subject.start && subject.end <= found.element.end,
  );

  addToChat({
    reference: {
      kind: "excerpt",
      source: {
        kind: "design",
        path: subject.path,
        frame: frame?.name ?? null,
        start: subject.start,
        end: subject.end,
      },
      text: text.slice(subject.start, subject.end),
    },
  });
}
