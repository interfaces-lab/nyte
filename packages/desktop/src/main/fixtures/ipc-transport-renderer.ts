import { Type } from "typebox";
import { Value } from "typebox/value";

const failure = Type.Object({
  name: Type.Literal("HostError"),
  message: Type.String(),
  cause: Type.Object({
    code: Type.String(),
    message: Type.String(),
    correlationId: Type.Optional(Type.String()),
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
    [() => window.nyte.host.state(), "stale"],
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
    }
  }

  const outcome = await window.nyte.host.pickWorkspace();
  check(outcome.kind === "cancelled", "Successful operation outcome survived");
  observed.push(outcome);

  check(
    !JSON.stringify(observed).includes("synthetic-secret"),
    "Private error body crossed bridge",
  );

  return ids;
}
