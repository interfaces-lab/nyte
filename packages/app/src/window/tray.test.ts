import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Execution, JobId, SessionInfo } from "@nyte-ai/sdk";
import { chatsFor, sessionRow } from "../../test/view-fixtures.ts";
import { listSubagents } from "../conversation/tray/agents.tsx";
import { showTray } from "./tray.ts";
import type { TrayView } from "./tray.ts";

const parent = asId<"session">("parent");

const WORKING: Execution = {
  kind: "live",
  run: {
    id: asId<"run">("run"),
    head: asId<"head">("main"),
    startedAt: 1,
    attempt: 1,
    origin: { kind: "input", message: asId<"message">("m") },
  },
  phase: "responding",
  stopping: false,
};

const agent = (id: string, working: boolean): SessionInfo =>
  working ? sessionRow(id, { parent }, WORKING) : sessionRow(id, { parent });

function shownOver(view: TrayView, agents: readonly SessionInfo[]): TrayView["kind"] {
  const listed =
    view.kind === "list"
      ? listSubagents(agents, view, chatsFor(agents)).listed.map(
          (listedAgent) => listedAgent.session.id,
        )
      : [];

  return showTray(view, { listed, live: [] }).kind;
}

test("an agents list stays open while an agent it opened over is listed, and doesn't reopen for new ones", () => {
  const opened = [agent("a", true), agent("b", true)];
  const closedPill = listSubagents(opened, { kind: "closed" }, chatsFor(opened));

  const list: TrayView = {
    kind: "list",
    retainedSessionId: undefined,
    openedOver: closedPill.listed.map((listedAgent) => listedAgent.session.id),
  };

  expect(shownOver(list, opened)).toBe("list");
  expect(shownOver(list, [agent("a", false), agent("b", true)])).toBe("list");
  expect(shownOver(list, [agent("a", true), agent("b", true), agent("c", true)])).toBe("list");
  expect(shownOver(list, [agent("a", false), agent("b", false)])).toBe("closed");

  expect(
    shownOver(list, [agent("a", false), agent("b", false), agent("c", true)]),
    "an agent started after the list emptied doesn't reopen it",
  ).toBe("closed");
});

test("a terminals tray stays open while a terminal it opened over runs, and doesn't reopen for new ones", () => {
  const first = asId<"job">("first");
  const second = asId<"job">("second");
  const later = asId<"job">("later");
  const terminals: TrayView = { kind: "terminals", openedOver: [first, second] };
  const shown = (live: readonly JobId[]) => showTray(terminals, { listed: [], live }).kind;

  expect(shown([first, second])).toBe("terminals");
  expect(shown([second, later])).toBe("terminals");
  expect(shown([])).toBe("closed");
  expect(shown([later]), "a terminal started after the tray emptied doesn't reopen it").toBe(
    "closed",
  );
});
