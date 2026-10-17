import { expect, test } from "bun:test";
import type { AuthDialog } from "../../../src/model/dialogs/auth.ts";
import { key, renderDialog } from "./harness.tsx";

function auth(step: AuthDialog["step"], mode: AuthDialog["mode"] = "login"): AuthDialog {
  return {
    kind: "auth",
    id: "a1",
    mode,
    provider: "anthropic",
    name: "Anthropic",
    link: null,
    step,
  };
}

test("the link step shows the url, the code and the open/copy keys", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(
      auth({ kind: "link", url: "https://example.com/device", code: "ABCD-1234" }),
      { width },
    );

    const frame = app.frame();

    expect(frame).toContain("Sign in to Anthropic");
    expect(frame).toContain("https://example.com/device");
    expect(frame).toContain("Code ABCD-1234");
    expect(frame).toContain("enter open");
    expect(frame).toContain("c copy");
    expect(frame).toContain("esc cancel");
  }
});

test("long masked and OAuth values keep their caret visible and support replacing a selection", async () => {
  const token = `prefix-${"x".repeat(480)}-visible-tail`;

  for (const masked of [true, false]) {
    await using app = await renderDialog(
      auth({ kind: "secret", prompt: "Paste the value", masked, codePoints: [] }),
      { width: 40 },
    );

    await app.send({ kind: "paste", text: token });

    if (masked) {
      expect(app.frame()).toContain("•".repeat(20));
      expect(app.frame()).not.toContain("visible-tail");
    } else {
      expect(app.frame()).toContain("visible-tail");
      expect(app.frame()).not.toContain("prefix-");
    }

    await app.send({ kind: "edit", edit: { kind: "select-all" } });
    await app.send({ kind: "edit", edit: { kind: "delete", to: "right" } });
    expect(app.frame()).not.toContain("•");
    expect(app.frame()).not.toContain("visible-tail");
    await app.send({ kind: "paste", text: "replacement" });
    expect(app.frame()).toContain(masked ? "•".repeat(11) : "replacement");
    expect(app.frame()).not.toContain("visible-tail");
  }
});

test("the choose step highlights an option and moves with the picker keys", async () => {
  await using app = await renderDialog(
    auth({
      kind: "choose",
      prompt: "How do you want to sign in?",
      options: [
        { id: "oauth", label: "Browser login" },
        { id: "key", label: "API key" },
      ],
      highlighted: 0,
    }),
  );

  expect(app.frame()).toContain("❯ Browser login");
  expect(app.frame()).toContain("  API key");
  await app.send(key("picker.next"));
  expect(app.frame()).toContain("❯ API key");
  expect(app.frame()).toContain("enter select");
});

test("waiting and logout titles read as expected", async () => {
  await using app = await renderDialog(
    auth({ kind: "waiting", message: "Waiting for the provider…" }, "logout"),
  );

  expect(app.frame()).toContain("Sign out of Anthropic");
  expect(app.frame()).toContain("Waiting for the provider…");
});
