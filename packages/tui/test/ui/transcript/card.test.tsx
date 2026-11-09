import { RGBA } from "@opentui/core";
import { expect, test } from "bun:test";
import { shellCard } from "../../../src/lib/tool-card.ts";
import { CardView } from "../../../src/ui/transcript/card.tsx";
import { ready } from "../../model/support.ts";
import { buildView } from "../../fixture/view.ts";
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
  const landed = Promise.withResolvers<void>();

  await using app = await mount(
    ready(buildView((v) => v)),
    () => <CardView id="card" card={card} />,
    { width: 60, height: 4 },
    {
      highlight: async (_text, filetype) => {
        await landed.promise;

        return filetype === "bash" ? [[0, 4, "keyword"]] : [];
      },
    },
  );

  const echo = () =>
    app
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("echo"));

  expect(app.captureCharFrame()).toContain("✓ ! echo kept");
  expect(echo()?.fg.equals(KEYWORD)).toBe(false);

  landed.resolve();
  await landed.promise;
  await app.renderOnce();

  expect(app.captureCharFrame()).toContain("✓ ! echo kept");
  expect(echo()?.fg.equals(KEYWORD)).toBe(true);
});
