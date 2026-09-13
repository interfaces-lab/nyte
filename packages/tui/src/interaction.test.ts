import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { cliInteraction } from "./interaction.ts";

describe("cliInteraction device codes", () => {
  const errors: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  afterEach(() => {
    errors.length = 0;
  });

  afterAll(() => {
    spy.mockRestore();
  });

  test("prints the provider's instructions with the URL and code", () => {
    cliInteraction(new AbortController().signal).notify({
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      instructions: "GitHub will show OpenCode as the OAuth app.",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "GitHub will show OpenCode as the OAuth app.\nVisit https://github.com/login/device and enter code: ",
    );
    expect(errors[0]).toContain("ABCD-1234");
  });

  test("prints only the URL and code when the provider gives no instructions", () => {
    cliInteraction(new AbortController().signal).notify({
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
    expect(errors[0]).toStartWith("\nVisit https://github.com/login/device and enter code: ");
  });
});
