import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { Choice, ListDialog } from "../../../src/model/dialogs/list.ts";
import { key, query, renderDialog, rows } from "./harness.tsx";

function choice(
  id: string,
  description = "",
  status: Choice["status"] = null,
  mark: Choice["mark"] = null,
): Choice {
  return { id, label: id, description, status, mark };
}

function list(overrides: Partial<ListDialog> & Pick<ListDialog, "purpose">): ListDialog {
  return {
    kind: "list",
    id: "l1",
    title: "Resume chat",
    choices: { kind: "ready", items: [] },
    query: "",
    highlighted: 0,
    answering: null,
    busy: false,
    ...overrides,
  };
}

const QUESTION = list({
  purpose: { kind: "question", session: asId("s1"), part: asId("p1"), typed: true },
  title: "Which approach?",
  choices: { kind: "ready", items: [choice("First"), choice("Second")] },
  answering: "",
});

const RESUME = list({
  purpose: { kind: "resume", sessions: [] },
  choices: {
    kind: "ready",
    items: [
      choice("alpha", "Mon 10:00 · a1b2c3d4", { text: "running", tone: "ok" }),
      choice("beta", "Sun 09:00 · b2c3d4e5"),
      choice("gamma", "Sat 08:00 · c3d4e5f6"),
    ],
  },
});

test("a question lists its options, the typed row and the hints at widths 40 and 100", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(QUESTION, { width });
    const frame = app.frame();

    expect(frame).toContain("Which approach?");
    expect(frame).toContain("❯ First");
    expect(frame).toContain("  Second");
    expect(frame).toContain("Type an answer");
    expect(frame).toContain("enter select");
    expect(frame).toContain("esc later");
  }
});

test("the filter keeps the matching rows and counts them", async () => {
  await using app = await renderDialog(RESUME);

  expect(app.frame()).toContain("type to filter");
  expect(app.frame()).toContain(" 3");
  await app.send(query("beta"));
  const frame = app.frame();

  expect(frame).toContain("beta");
  expect(frame).toContain("❯ beta");
  expect(frame).not.toContain("alpha");
  expect(frame).toContain("1/3");
  await app.send(query("zzz"));
  expect(app.frame()).toContain("No matches");
});

test("moving the highlight moves the prompt glyph", async () => {
  await using app = await renderDialog(RESUME);

  expect(app.frame()).toContain("❯ alpha");
  await app.send(key("picker.next"));
  expect(app.frame()).toContain("  alpha");
  expect(app.frame()).toContain("❯ beta");
  await app.send(key("picker.previous"));
  await app.send(key("picker.previous"));
  expect(app.frame()).toContain("❯ gamma");
});

test("the detail column shows the description and status when wide and drops when narrow", async () => {
  await using wide = await renderDialog(RESUME, { width: 100 });

  expect(wide.frame()).toContain("alpha    Mon 10:00 · a1b2c3d4 · running");
  await using narrow = await renderDialog(RESUME, { width: 40 });
  expect(narrow.frame()).toContain("❯ alpha");
  expect(narrow.frame()).not.toContain("running");
});

test("the typed row takes the highlight past the last option and shows what was typed", async () => {
  await using app = await renderDialog(QUESTION);
  await app.send(key("picker.previous"));
  const lit = rows(app.frame()).find((row) => row.includes("Type an answer"));

  expect(lit).toBeDefined();
  expect(lit?.trimStart().startsWith("❯")).toBe(true);
  expect(app.frame()).toContain("  First");
  await app.send(query("use the second one"));
  expect(app.frame()).toContain("❯ use the second one");
  expect(app.frame()).not.toContain("Type an answer");
});

test("clicking a row dispatches pick for it", async () => {
  await using app = await renderDialog(RESUME);
  const y = rows(app.frame()).findIndex((row) => row.includes("beta"));

  expect(y).toBeGreaterThan(0);
  await app.mockMouse.click(6, y);
  await app.renderOnce();
  expect(app.dispatched).toContainEqual({ kind: "dialog", command: { kind: "pick", index: 1 } });
});

test("loading, empty and failed lists say so", async () => {
  await using loading = await renderDialog(list({ ...RESUME, choices: { kind: "loading" } }));

  expect(loading.frame()).toContain("Loading…");

  await using empty = await renderDialog(
    list({ ...RESUME, choices: { kind: "ready", items: [] } }),
  );

  expect(empty.frame()).toContain("No saved chats");

  await using failed = await renderDialog(
    list({ ...RESUME, choices: { kind: "failed", message: "Host went away" } }),
  );

  expect(failed.frame()).toContain("Host went away");
});

test("marks draw before the label", async () => {
  const marked = list({
    purpose: { kind: "resume", sessions: [] },
    choices: {
      kind: "ready",
      items: [choice("alpha", "", null, { glyph: "●", tone: "running" }), choice("beta")],
    },
  });

  await using app = await renderDialog(marked);

  expect(app.frame()).toContain("❯ ● alpha");
  expect(app.frame()).toContain("    beta");
});

test("a purpose with row actions lists them in the hints", async () => {
  await using app = await renderDialog(
    list({ purpose: { kind: "queue", message: asId("m1") }, title: "Queued messages" }),
  );

  const frame = app.frame();

  expect(frame).toContain("Nothing is queued");
  expect(frame).toContain("enter send now");
  expect(frame).toContain("ctrl+e edit");
  expect(frame).toContain("ctrl+d delete");
});
