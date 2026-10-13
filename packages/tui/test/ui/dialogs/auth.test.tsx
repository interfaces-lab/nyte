import { expect, test } from "bun:test";
import type { AuthDialog } from "../../../src/model/dialogs/auth.ts";
import { key, query, renderDialog } from "./harness.tsx";

function auth(step: AuthDialog["step"], mode: AuthDialog["mode"] = "login"): AuthDialog {
  return { kind: "auth", id: "a1", mode, provider: "anthropic", step };
}

test("the link step shows the url, the code and the open/copy keys", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(
      auth({ kind: "link", url: "https://example.com/device", code: "ABCD-1234" }),
      { width },
    );

    const frame = app.frame();

    expect(frame).toContain("Sign in to anthropic");
    expect(frame).toContain("https://example.com/device");
    expect(frame).toContain("Code: ABCD-1234");
    expect(frame).toContain("enter open");
    expect(frame).toContain("c copy");
    expect(frame).toContain("esc cancel");
  }
});

test("a masked secret draws bullets and never the text", async () => {
  await using app = await renderDialog(
    auth({ kind: "secret", prompt: "Paste your API key", masked: true, codePoints: [] }),
  );

  expect(app.frame()).toContain("Paste your API key");
  await app.send(query("sk-secret"));
  const frame = app.frame();

  expect(frame).toContain("•".repeat(9));
  expect(frame).not.toContain("sk-secret");
  expect(frame).toContain("enter submit");
});

test("an unmasked secret shows what was typed", async () => {
  await using app = await renderDialog(
    auth({ kind: "secret", prompt: "Enter the code", masked: false, codePoints: [] }),
  );

  await app.send(query("123456"));
  expect(app.frame()).toContain("123456");
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

  expect(app.frame()).toContain("Sign out of anthropic");
  expect(app.frame()).toContain("Waiting for the provider…");
});
