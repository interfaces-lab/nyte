import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { JobId, SessionId } from "@nyte-ai/sdk";
import { drawnTray, showTray } from "./tray.ts";
import type { TrayView } from "./tray.ts";

test("an agents list stays open while an agent it opened over is listed, and doesn't reopen for new ones", () => {
  const [a, b, c] = ["a", "b", "c"].map((id) => asId<"session">(id));
  const list: TrayView = { kind: "list", openedOver: [a, b] };
  const shown = (agents: readonly SessionId[]) => showTray(list, { agents, terminals: [] }).kind;

  expect(shown([a, b])).toBe("list");
  expect(shown([b])).toBe("list");
  expect(shown([a, b, c])).toBe("list");
  expect(shown([])).toBe("closed");
  expect(shown([c]), "an agent listed after the list emptied doesn't reopen it").toBe("closed");
});

test("a terminals tray stays open while a terminal it opened over is listed, and doesn't reopen for new ones", () => {
  const first = asId<"job">("first");
  const second = asId<"job">("second");
  const later = asId<"job">("later");
  const terminals: TrayView = { kind: "terminals", openedOver: [first, second] };
  const shown = (listed: readonly JobId[]) =>
    showTray(terminals, { agents: [], terminals: listed }).kind;

  expect(shown([first, second])).toBe("terminals");
  expect(shown([second, later])).toBe("terminals");
  expect(shown([])).toBe("closed");
  expect(shown([later]), "a terminal listed after the tray emptied doesn't reopen it").toBe(
    "closed",
  );
});

test.each([
  ["a list draws at once", "list", "detail core", "detail core", "list"],
  ["a detail waits behind the list it opened from", "detail app", "list", "list", "list"],
  ["a detail draws once its render arrives", "detail app", "detail app", "list", "detail app"],
  [
    "a deferred render still on the agent opened before draws the list, not that agent",
    "detail app",
    "detail core",
    "list",
    "list",
  ],
  [
    "a detail opened from another detail keeps it until it arrives",
    "detail app",
    "detail core",
    "detail core",
    "detail core",
  ],
] as const)("%s", (_, current, deferred, drawn, expected) => {
  const view = (name: string): TrayView => {
    const [kind, id] = name.split(" ");

    if (kind === "detail") return { kind: "detail", sessionId: asId<"session">(id ?? "") };

    return { kind: "list", openedOver: [asId<"session">("core"), asId<"session">("app")] };
  };

  const shown = drawnTray(view(current), view(deferred), view(drawn));

  expect(shown.kind === "detail" ? `detail ${shown.sessionId}` : shown.kind).toBe(expected);
});
