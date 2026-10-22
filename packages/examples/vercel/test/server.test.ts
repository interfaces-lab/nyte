import { decodeError } from "@nyte-ai/protocol";
import { describe, expect, it } from "vitest";
import { answerRepair } from "../server/utils/repair.ts";
import { stepFrom } from "../server/utils/step.ts";

const SECRET = "a-cron-secret";

function repairRequest(authorization?: string, method = "GET"): Request {
  return new Request("http://host.test/.nyte/repair", {
    method,
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

describe("stepFrom (§42s)", () => {
  it("advances on continue, sleeps until a timer or retry, and stops on idle, fenced, an untimed wait and busy", () => {
    expect(stepFrom({ kind: "continue" }, 100)).toEqual({ kind: "advance" });
    expect(stepFrom({ kind: "waiting", until: 160 }, 100)).toEqual({ kind: "sleep", ms: 60 });
    expect(stepFrom({ kind: "retry", until: 130 }, 100)).toEqual({ kind: "sleep", ms: 30 });
    expect(stepFrom({ kind: "waiting", until: 90 }, 100)).toEqual({ kind: "advance" });
    expect(stepFrom({ kind: "retry", until: 100 }, 100)).toEqual({ kind: "advance" });
    expect(stepFrom({ kind: "waiting", until: null }, 100)).toEqual({ kind: "stop" });
    expect(stepFrom({ kind: "busy", until: 500 }, 100)).toEqual({ kind: "stop" });
    expect(stepFrom({ kind: "idle" }, 100)).toEqual({ kind: "stop" });
    expect(stepFrom({ kind: "fenced" }, 100)).toEqual({ kind: "stop" });
  });
});

describe("the repair route's guard", () => {
  it("runs repair for the cron's bearer and answers 204", async () => {
    let repairs = 0;

    const response = await answerRepair(repairRequest(`Bearer ${SECRET}`), SECRET, async () => {
      repairs += 1;
    });

    expect(response?.status).toBe(204);
    expect(repairs).toBe(1);
  });

  it("refuses a missing or wrong bearer, and answers unknown when no CRON_SECRET is set, running nothing", async () => {
    let repairs = 0;

    const repair = async (): Promise<void> => {
      repairs += 1;
    };

    for (const authorization of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET]) {
      const refused = await answerRepair(repairRequest(authorization), SECRET, repair);

      expect(refused?.status).toBe(401);
      expect(decodeError(JSON.parse(await (refused?.text() ?? "{}")), 401).code).toBe(
        "unauthenticated",
      );
    }

    for (const secret of [undefined, ""]) {
      const unset = await answerRepair(repairRequest(`Bearer ${SECRET}`), secret, repair);

      expect(unset?.status).toBe(404);
    }

    expect(repairs).toBe(0);
  });

  it("passes every other request on to the listener", async () => {
    const repair = async (): Promise<void> => undefined;

    expect(
      await answerRepair(repairRequest(`Bearer ${SECRET}`, "POST"), SECRET, repair),
    ).toBeUndefined();
    expect(
      await answerRepair(
        new Request("http://host.test/sessions.list", { method: "POST" }),
        SECRET,
        repair,
      ),
    ).toBeUndefined();
  });
});
