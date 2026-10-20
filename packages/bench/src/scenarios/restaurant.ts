import { KIT_SPECIFIER } from "@nyte-ai/plugin/canvas/protocol";
import type { Reply } from "../fake-models.ts";
import { afterTool, afterUser, script } from "../script.ts";
import type { Script } from "../script.ts";
import { PLACES_SERVER, scenarioHome } from "./home.ts";
import type { ScenarioHome } from "./home.ts";

export const RESTAURANT_PROMPT = "find me a random restaurant nearby";

export const PLACES_TOOL = "mcp__places__search_places";

export const RESTAURANT_SKILL = `---
name: restaurant-picker
description: Pick a random nearby restaurant with the places MCP server and show it as a canvas.
---
1. Call ${PLACES_TOOL} with near="here" and limit=5.
2. Pick one at random and render it with canvas_render using Card, Heading, Badge and Table.
3. Link the place's url so the user can open the menu.
`;

export const RESTAURANT_CANVAS = `import { useState } from "react";
import { Badge, Button, Card, Heading, Stack, Table, Text } from "${KIT_SPECIFIER}";

const PLACES = [
  { name: "Luigi's Trattoria", cuisine: "Italian", distance: "0.4 km", url: "https://fixture.test/places/luigi" },
  { name: "Saffron House", cuisine: "Indian", distance: "0.7 km", url: "https://fixture.test/places/saffron" },
  { name: "Noodle Bar 88", cuisine: "Ramen", distance: "1.1 km", url: "https://fixture.test/places/noodle-88" },
];

export default function RandomPick() {
  const [index, setIndex] = useState(0);
  const pick = PLACES[index];

  return (
    <Card
      title="Random pick nearby"
      actions={<Button size="sm" onClick={() => setIndex((index + 1) % PLACES.length)}>Reroll</Button>}
    >
      <Stack gap={2}>
        <Heading level={3}>{pick.name}</Heading>
        <Stack direction="row" gap={2}>
          <Badge tone="info">{pick.cuisine}</Badge>
          <Text tone="secondary">{pick.distance}</Text>
        </Stack>
        <a href={pick.url}>Open menu</a>
        <Table
          columns={[{ key: "name", label: "Place" }, { key: "distance", label: "Distance", align: "end" }]}
          rows={PLACES.map((place) => ({ name: place.name, distance: place.distance }))}
        />
      </Stack>
    </Card>
  );
}
`;

export const RESTAURANT_ANSWER =
  "I picked **Luigi's Trattoria** (0.4 km). [Open the menu](https://fixture.test/places/luigi).";

export type PlacesRoute = "direct" | "codemode";

const PACE: Reply["timing"] = { firstMs: 30, deltaMs: 2 };

export function restaurantScript(input: {
  readonly skill: string;
  readonly route: PlacesRoute;
}): Script {
  const search = { near: "here", limit: 5 };

  return script([
    {
      name: "read the skill",
      when: afterUser,
      reply: {
        timing: PACE,
        content: [
          { type: "text", text: "Let me look nearby." },
          { type: "toolCall", id: "skill", name: "read", arguments: { path: input.skill } },
        ],
      },
    },
    {
      name: "search places",
      when: afterTool("read"),
      reply: {
        timing: PACE,
        content: [
          input.route === "direct"
            ? { type: "toolCall", id: "search", name: PLACES_TOOL, arguments: search }
            : {
                type: "toolCall",
                id: "search",
                name: "codemode",
                arguments: {
                  code: `return await tools.${PLACES_TOOL}(${JSON.stringify(search)});`,
                },
              },
        ],
      },
    },
    {
      name: "render the pick",
      when: afterTool(input.route === "direct" ? PLACES_TOOL : "codemode"),
      reply: {
        timing: PACE,
        content: [
          {
            type: "toolCall",
            id: "canvas",
            name: "canvas_render",
            arguments: { title: "Random pick nearby", source: RESTAURANT_CANVAS },
            deltas: 40,
          },
        ],
      },
    },
    {
      name: "answer",
      when: afterTool("canvas_render"),
      reply: { timing: PACE, tokens: 12, content: [{ type: "text", text: RESTAURANT_ANSWER }] },
    },
  ]);
}

export function restaurantHome(input?: {
  readonly route?: PlacesRoute;
  readonly env?: Readonly<Record<string, string>>;
  readonly root?: string;
}): Promise<ScenarioHome> {
  return scenarioHome({
    servers: {
      places: {
        script: PLACES_SERVER,
        env: input?.env ?? { PLACES_DELAY_MS: "50" },
        exposure: input?.route ?? "direct",
      },
    },
    skills: { "restaurant-picker": RESTAURANT_SKILL },
    root: input?.root,
  });
}
