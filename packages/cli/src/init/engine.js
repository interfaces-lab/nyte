/**
 * @typedef {{ state: "done", detail: string } | { state: "todo" | "unknown", detail?: string }} Check
 *
 * @typedef {object} Step
 * @property {string} id
 * @property {string} title
 * @property {"install" | "setup"} group
 * @property {(ctx: any) => boolean} [applies]
 * @property {(ctx: any) => Promise<Check>} check
 * @property {(ctx: any) => string} plan
 * @property {(ctx: any, io: StepIO) => Promise<string | void>} apply
 * @property {(ctx: any) => string | undefined} [person]
 * @property {(ctx: any) => string} [manual]
 * @property {readonly string[]} [after]
 *
 * @typedef {object} StepIO
 * @property {(line: string) => void} line
 * @property {(message: string) => void} handOver
 *
 * @typedef {"apply" | "recheck" | "done"} Mark
 * @typedef {{ step: Step, check: Check, mark: Mark }} PlanRow
 */

export const EXIT = { ready: 0, failed: 1, needsPerson: 2, cancelled: 130 };

export class Interrupted extends Error {}

/**
 * @param {readonly Step[]} steps
 * @param {readonly Check[]} checks
 * @returns {PlanRow[]}
 */
export function planFrom(steps, checks) {
  const applying = new Set(
    steps.filter((_, index) => checks[index]?.state !== "done").map((step) => step.id),
  );

  return steps.map((step, index) => {
    const check = checks[index] ?? { state: "unknown" };

    if (check.state !== "done") return { step, check, mark: "apply" };

    const recheck = (step.after ?? []).some((id) => applying.has(id));

    return { step, check, mark: recheck ? "recheck" : "done" };
  });
}

/**
 * @param {object} options
 * @param {readonly Step[]} options.steps
 * @param {any} options.ctx
 * @param {import("./ui.js").InitUI} options.ui
 * @param {boolean} options.yes
 * @param {boolean} options.checkOnly
 * @param {boolean} options.interactive
 * @param {() => boolean} [options.interrupted]
 * @returns {Promise<number>}
 */
export async function runSteps({ steps, ctx, ui, yes, checkOnly, interactive, interrupted }) {
  const active = steps.filter((step) => step.applies?.(ctx) ?? true);
  const checks = await ui.checking(() => Promise.all(active.map((step) => safeCheck(step, ctx))));
  const plan = planFrom(active, checks);
  const pending = plan.filter((row) => row.mark !== "done");

  if (pending.length === 0) {
    ui.nothingToDo(plan);

    return EXIT.ready;
  }

  ui.plan(plan);

  if (checkOnly) return EXIT.failed;

  const people = plan.filter((row) => row.mark === "apply" && row.step.person?.(ctx) !== undefined);

  if (!interactive && people.length > 0) {
    ui.needsPerson(
      people.map((row) => ({ title: row.step.title, command: row.step.manual?.(ctx) })),
    );

    return EXIT.needsPerson;
  }

  if (!yes) {
    if (!interactive) {
      ui.needsPerson([{ title: "Confirm the plan", command: "npx nyte-ai init --yes" }]);

      return EXIT.needsPerson;
    }

    const confirmed = await ui.confirm(
      plan,
      people.map((row) => row.step.person?.(ctx) ?? ""),
    );

    if (!confirmed) {
      ui.cancelled();

      return EXIT.cancelled;
    }
  }

  const started = Date.now();
  let applied = 0;

  for (const row of pending) {
    const { step } = row;
    const before = await safeCheck(step, ctx);

    if (before.state === "done") {
      if (row.mark === "apply") ui.alreadyDone(step, before.detail);
      continue;
    }

    const stepStarted = Date.now();
    const io = ui.stepStart(step, step.plan(ctx));
    let did;

    try {
      did = await step.apply(ctx, io);
    } catch (error) {
      if (error instanceof Interrupted || interrupted?.()) {
        ui.stepInterrupted(step);

        return EXIT.cancelled;
      }

      ui.stepFailed(step, describeError(error), remaining(pending, step));

      return EXIT.failed;
    }

    const after = await safeCheck(step, ctx);

    if (after.state !== "done") {
      const why = after.detail ?? "its check still fails";
      ui.stepFailed(step, `It finished, but ${why}.`, remaining(pending, step));

      return EXIT.failed;
    }

    applied += 1;
    ui.stepDone(step, did || after.detail, Date.now() - stepStarted);
  }

  ui.ready({ applied, done: plan.length - pending.length, ms: Date.now() - started });

  return EXIT.ready;
}

async function safeCheck(step, ctx) {
  try {
    return await step.check(ctx);
  } catch (error) {
    return { state: "todo", detail: describeError(error) };
  }
}

function remaining(pending, failed) {
  return pending
    .slice(pending.findIndex((row) => row.step === failed))
    .map((row) => row.step.title);
}

export function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
