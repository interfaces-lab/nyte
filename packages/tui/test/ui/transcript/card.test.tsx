/**
 * A tool card's heading: a shell command draws plain until the kit's label
 * highlights land, then in the highlight's colours.
 */
import { RGBA } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { shellCard } from "../../../src/lib/tool-card.ts";
import { CardView } from "../../../src/ui/transcript/card.tsx";
import { ready } from "../../model/support.ts";
import { viewOf } from "../../fixture/view.ts";
import { mount } from "../chrome/support.tsx";

const KEYWORD = RGBA.fromHex("#ff0000");

const card = shellCard(
  {
    id: "j1",
    session: null,
    command: "echo kept",
    include: true,
    startedAt: 0,
    output: "",
    state: { kind: "exited", code: 0 },
    delivered: false,
  },
  0,
  false,
);

test("a shell command takes its bash highlights once they land", async () => {
  const [landed, setLanded] = createSignal(false);

  const highlighted = (text: string): readonly TextChunk[] => [
    { __isChunk: true, text: text.slice(0, 4), fg: KEYWORD },
    { __isChunk: true, text: text.slice(4) },
  ];

  await using app = await mount(
    ready(viewOf((v) => v)),
    () => <CardView id="card" card={card} />,
    { width: 60, height: 4 },
    { highlight: (text, filetype) => (landed() && filetype === "bash" ? highlighted(text) : null) },
  );

  const echo = () =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("echo"));

  expect(app.captureCharFrame()).toContain("✓ ! echo kept");
  expect(echo()?.fg.equals(KEYWORD)).toBe(false);

  setLanded(true);
  await app.renderOnce();

  expect(app.captureCharFrame()).toContain("✓ ! echo kept");
  expect(echo()?.fg.equals(KEYWORD)).toBe(true);
});
