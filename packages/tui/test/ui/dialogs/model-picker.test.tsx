import { expect, test } from "bun:test";
import type { ModelDialog } from "../../../src/model/dialogs/model-picker.ts";
import { modelList, withModels } from "../../../src/model/dialogs/model-picker.ts";
import { CATALOG } from "../../fixture/state.ts";
import { key, query, renderDialog, rows } from "./harness.tsx";

const LOADING: ModelDialog = {
  kind: "model",
  id: "m1",
  models: { kind: "loading" },
  query: "",
  highlighted: 0,
  field: "effort",
  drafts: new Map(),
  current: { provider: "test", id: "model" },
  effort: "medium",
};

const READY = withModels(LOADING, modelList(CATALOG));

test("cached model selection stays visible before credential availability is known", async () => {
  const catalog = {
    ...CATALOG,
    providers: CATALOG.providers.map((provider) => ({
      ...provider,
      credential: "unknown" as const,
    })),
  };
  await using app = await renderDialog(withModels(LOADING, modelList(catalog)));
  const frame = app.frame();

  expect(frame).toContain("❯ Model");
  expect(frame).toContain("100k context");
  expect(frame).not.toContain("No models available");
});

test("rows show the name, the effort and the fast field at widths 40 and 100", async () => {
  await using wide = await renderDialog(READY, { width: 100 });
  const frame = wide.frame();

  expect(frame).toContain("❯ Model");
  expect(frame).toContain("Model Fast");
  expect(frame).toContain("■■■□");
  expect(frame).toContain("← ■■■□");
  expect(frame).toContain("Medium  →");
  expect(frame).toContain("Fast mode Off");
  expect(frame).toContain("2/2");

  await using narrow = await renderDialog(READY, { width: 40 });
  const row = rows(narrow.frame()).find((line) => line.includes("❯ Model"));

  expect(row).toContain("Medium");
  expect(row).not.toContain("Fast mode");
});

test("the details pane prices the highlighted model", async () => {
  await using app = await renderDialog(READY);
  const frame = app.frame();

  expect(frame).toContain("test/model · Medium · Fast mode Off");
  expect(frame).toContain("Input");
  expect(frame).toContain("$1 / 1M");
  expect(frame).toContain("$2 / 1M");
  expect(frame).toContain("100k context");
  expect(frame).toContain("enter confirm");
});

test("the fast field toggles with the field cycle and the increase key", async () => {
  await using app = await renderDialog(READY);
  await app.send(key("model.field.cycle"));
  expect(app.frame()).toContain("← Fast mode Off →");
  await app.send(key("model.increase"));
  expect(app.frame()).toContain("Fast mode On");
  expect(app.frame()).toContain("Fast-mode pricing unavailable");
  expect(app.frame()).toContain("Unavailable");
});

test("the effort field steps along the model's levels", async () => {
  await using app = await renderDialog(READY);
  await app.send(key("model.increase"));
  expect(app.frame()).toContain("■■■■");
  expect(app.frame()).toContain("High");
  await app.send(key("model.decrease"));
  await app.send(key("model.decrease"));
  expect(app.frame()).toContain("Low");
});

test("moving the highlight keeps the current mark on the opening row", async () => {
  await using app = await renderDialog(READY);
  await app.send(key("model.next"));
  expect(app.frame()).toContain("· Model ");
  expect(app.frame()).toContain("❯ Model Fast");
});

test("search narrows the rows and counts the matches", async () => {
  await using app = await renderDialog(READY);
  await app.send(query("fast"));
  const frame = app.frame();

  expect(frame).toContain("❯ Model Fast");
  expect(frame).toContain("1/2");
  await app.send(query("nothing"));
  expect(app.frame()).toContain("No matching models");
});

test("loading and failed catalogs say so", async () => {
  await using loading = await renderDialog(LOADING);

  expect(loading.frame()).toContain("Loading models…");
  await using failed = await renderDialog({ ...LOADING, models: { kind: "failed", message: "x" } });
  expect(failed.frame()).toContain("Close and try /model again");
});

test("the wheel moves the highlight and a click only highlights", async () => {
  await using app = await renderDialog(READY);
  const fast = rows(app.frame()).findIndex((line) => line.includes("Model Fast"));

  await app.mockMouse.scroll(10, fast, "down");
  expect(app.dispatched).toContainEqual({
    kind: "dialog",
    command: { kind: "key", name: "model.next" },
  });
  await app.mockMouse.scroll(10, fast, "up");
  expect(app.dispatched.at(-1)).toEqual({
    kind: "dialog",
    command: { kind: "key", name: "model.previous" },
  });

  await app.mockMouse.click(10, fast);
  expect(app.dispatched.at(-1)).toEqual({
    kind: "dialog",
    command: { kind: "highlight", index: 1 },
  });
  await app.send({ kind: "highlight", index: 1 });
  expect(app.frame()).toContain("❯ Model Fast");
  expect(app.frame()).toContain("enter confirm");
});

test("a model with one level and no fast sibling offers no field to change", async () => {
  await using app = await renderDialog(READY, { width: 100 });

  expect(app.frame()).toContain("Models");
  expect(app.frame()).toContain("←→ reasoning effort");
  await app.send(key("model.next"));
  expect(app.frame()).toContain("❯ Model Fast");
  expect(app.frame()).not.toContain("←→");
  await app.send(key("model.increase"));
  expect(rows(app.frame()).find((line) => line.includes("❯ Model Fast"))).toContain("Off");
});
