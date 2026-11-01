import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { JobId, SessionId } from "@nyte-ai/sdk";
import { showTray } from "./tray.ts";
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
