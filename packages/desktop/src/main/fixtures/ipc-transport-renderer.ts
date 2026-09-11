import { Type } from "typebox";
import { Value } from "typebox/value";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionEvent } from "@nyte-ai/core";

const failure = Type.Object({
  name: Type.Literal("HostError"),
  message: Type.String(),
  cause: Type.Object({
    code: Type.String(),
    message: Type.String(),
    correlationId: Type.Optional(Type.String()),
    floor: Type.Optional(Type.Number()),
  }),
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function run(): Promise<string[]> {
  const observed: unknown[] = [];
  const ids: string[] = [];
  for (const [operation, code] of [
    [() => window.nyte.host.fonts(), "internal"],
    [() => window.nyte.host.state(), "cursor_expired"],
  ] as const) {
    const result = await operation().then(
      () => {
        throw new Error("Expected promise rejection");
      },
      (cause: unknown) => {
        if (!Value.Check(failure, cause)) throw new Error("Malformed promise rejection");
        return cause;
      },
    );
    observed.push(result);
    check(result.cause.code === code, "Promise rejection category survived contextBridge");
    check(result.message === result.cause.message, "Safe cause message survived");
    if (code === "internal") {
      check(result.cause.correlationId !== undefined, "Promise correlation survived");
      if (result.cause.correlationId !== undefined) ids.push(result.cause.correlationId);
    } else check(result.cause.floor === 23, "Cursor floor survived");
  }
  const outcome = await window.nyte.host.pickWorkspace();
  check(outcome.kind === "cancelled", "Successful operation outcome survived");
  observed.push(outcome);
  for (const id of ["watch-failure", "start-failure"]) {
    const events: SessionEvent[] = [];
    const ended = Promise.withResolvers<Error>();
    const stop = window.nyte.watch(
      { sessionId: sessionId(id), live: true },
      (event) => events.push(event),
      ended.resolve,
    );
    const result = await ended.promise;
    if (!Value.Check(failure, result)) throw new Error("Malformed watch failure");
    stop();
    check(result.cause.code === "internal", "Watch category survived contextBridge callback");
    check(result.cause.correlationId !== undefined, "Watch correlation survived");
    if (result.cause.correlationId !== undefined) ids.push(result.cause.correlationId);
    check(events.length === (id === "watch-failure" ? 1 : 0), "Successful watch event survived");
    if (id === "watch-failure") {
      check(events[0]?.kind === "activation_changed", "Watch event variant survived");
    }
    observed.push(result, events);
  }
  check(
    !JSON.stringify(observed).includes("synthetic-secret"),
    "Private error body crossed bridge",
  );
  return ids;
}
