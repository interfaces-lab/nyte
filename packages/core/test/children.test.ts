import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, HeadName, SessionId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { main, setup, until } from "../src/harness.ts";
import type { Session } from "../src/index.ts";

const side: HeadName = asId("side");

/** The state of `child`'s item in `parent`'s background, once it is `state`. */
function childState(
  parent: Session,
  child: SessionId,
  state: BackgroundItem["state"],
): Promise<BackgroundItem["state"]> {
  return until(async () => {
    const item = (await parent.view()).background.find((entry) => entry.id === child);

    return item?.state === state ? item.state : undefined;
  });
}

describe("child background items", () => {
  it("follows the child's main head, not a run on another of its heads", async () => {
    const { host, script: turns } = await setup();
    const { session: parent } = await host.sessions.start({ content: "Delegate." });
    const { session: child } = await host.sessions.start({ parent: parent.id, content: "Go." });
    const working = host.execution.advance({ session: child.id, head: main });
    const own = await turns.started(1);

    await childState(parent, child.id, "working");
    await child.heads.create(side);
    await child.head(side).send("Try another way.");
    const elsewhere = host.execution.advance({ session: child.id, head: side });
    (await turns.started(2)).finish();
    await elsewhere;

    expect((await parent.view()).background).toMatchObject([{ id: child.id, state: "working" }]);

    own.finish();
    await working;

    expect(await childState(parent, child.id, "done")).toBe("done");
  });
});
