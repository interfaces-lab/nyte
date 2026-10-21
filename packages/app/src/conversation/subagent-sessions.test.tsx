import assert from "node:assert/strict";
import { test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { asId } from "@nyte-ai/schema";
import { childrenWatch, installConnection } from "../sdk.tsx";
import {
  subagentSessions,
  SubagentSessionsProvider,
  useChildSession,
} from "./subagent-sessions.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const RETAINED_WATCHES = 16;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("agent cards read their parent's current child list after a hidden conversation's idle list is evicted", async () => {
  const parent = asId<"session">("hidden");
  const child = sessionRow("child", { name: "Map the core", parent });
  installConnection(scriptedConnection({ sessions: [child] }).connection);
  const subagents = subagentSessions(parent, () => undefined);

  const held = childrenWatch(parent);
  const leave = subagents.children.subscribeByFrame(() => undefined);
  await held.first();
  leave();
  await settle();

  for (let index = 0; index <= RETAINED_WATCHES; index += 1)
    childrenWatch(asId<"session">(`other-${String(index)}`));

  assert.notEqual(childrenWatch(parent), held);
  assert.equal(held.value, undefined);

  const hold = subagents.children.subscribeByFrame(() => undefined);
  await childrenWatch(parent).first();

  function ChildName(): ReactElement {
    return <>{useChildSession(child.id)?.name ?? "unlisted"}</>;
  }

  const html = renderToStaticMarkup(
    <SubagentSessionsProvider value={subagents}>
      <ChildName />
    </SubagentSessionsProvider>,
  );
  hold();

  assert.equal(html, "Map the core");
});
