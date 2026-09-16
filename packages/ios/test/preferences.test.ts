import { describe, expect, it } from "vitest";
import { resolveChoice, type Choices } from "../src/settings/choice.ts";

const themes = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
] as const satisfies Choices<"system" | "light">;

describe("resolveChoice", () => {
  it("keeps a stored choice", () => {
    expect(resolveChoice(themes, "light").label).toBe("Light");
  });

  it("defaults to the first choice when nothing is stored", () => {
    expect(resolveChoice(themes, undefined).value).toBe("system");
  });

  it("defaults when the stored value is no longer offered", () => {
    expect(resolveChoice(themes, "sepia").value).toBe("system");
  });
});
