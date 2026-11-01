import * as clack from "@clack/prompts";

/**
 * The two faces of init: clack in a terminal, plain lines everywhere else
 * (CI logs, pipes). Both show the same plan with the same marks:
 *   + apply   → apply, and a vendor tool or a person acts   ~ checked again   ✓ done
 */
export function duration(ms) {
  const seconds = Math.round(ms / 1000);

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * @typedef {import("./engine.js").PlanRow} PlanRow
 * @typedef {import("./engine.js").Step} Step
 * @typedef {import("./engine.js").StepIO} StepIO
 *
 * @typedef {object} InitUI
 * @property {<T>(work: () => Promise<T>) => Promise<T>} checking
 * @property {(plan: PlanRow[]) => void} nothingToDo
 * @property {(plan: PlanRow[]) => void} plan
 * @property {(plan: PlanRow[], people: string[]) => Promise<boolean>} confirm
 * @property {(items: { title: string, command?: string }[]) => void} needsPerson
 * @property {() => void} cancelled
 * @property {(step: Step, detail: string) => void} alreadyDone
 * @property {(step: Step, plan: string) => StepIO} stepStart
 * @property {(step: Step, detail: string, ms: number) => void} stepDone
 * @property {(step: Step, message: string, remaining: string[]) => void} stepFailed
 * @property {(step: Step) => void} stepInterrupted
 * @property {(summary: { applied: number, done: number, ms: number }) => void} ready
 */
/** Plan lines without styling: what to apply first, then what is already done. */
export function planLines(plan, ctx) {
  const titles = new Map(plan.map((row) => [row.step.id, row.step.title]));
  const width = Math.max(...plan.map((row) => row.step.title.length)) + 3;
  const line = (mark, title, detail) => `${mark} ${title.padEnd(width)}${detail}`.trimEnd();

  const rows = (group) =>
    plan
      .filter((row) => row.mark !== "done" && row.step.group === group)
      .map((row) => {
        if (row.mark === "recheck") {
          const after = (row.step.after ?? []).map((id) => titles.get(id)).filter(Boolean);

          return line("~", row.step.title, `checked again after ${after.join(", ")}`);
        }

        const mark = row.step.person?.(ctx) === undefined ? "+" : "→";

        return line(mark, row.step.title, row.step.plan(ctx));
      });

  const install = rows("install");
  const setup = rows("setup");
  const done = plan.filter((row) => row.mark === "done").map((row) => `✓ ${row.check.detail}`);

  return [
    ...(install.length > 0 ? ["Install", ...install, ""] : []),
    ...(setup.length > 0 ? [...(install.length > 0 ? ["Set up"] : []), ...setup, ""] : []),
    ...done,
  ];
}

export function question(plan, people) {
  const apply = plan.filter((row) => row.mark === "apply").length;
  const recheck = plan.filter((row) => row.mark === "recheck").length;
  const steps = `${apply} step${apply === 1 ? "" : "s"}`;
  const more = recheck === 0 ? "" : `, and ${recheck} more if the update needs them`;

  const you =
    people.length === 0
      ? ""
      : ` You'll ${people.length === 1 ? people[0] : `${people.slice(0, -1).join(", ")} and ${people.at(-1)}`}.`;

  return `Apply ${steps}${more}?${you}`;
}

function failureFooter(ctx, step) {
  return [
    `Full log: ${ctx.tilde(ctx.log.path)}`,
    `Stopped at ${step.title}. Run npx nyte-ai init again to continue from there.`,
    "Stuck? npx nyte-ai triage",
  ];
}

/**
 * `finish` ends the running step's spinner or task log; each step replaces it.
 *
 * @returns {InitUI}
 */
export function clackUI(ctx, next) {
  const machine = ctx.platform === "darwin" ? "Mac" : "machine";
  let finish = (message, ok) => (ok ? clack.log.step(message) : clack.log.error(message));
  clack.intro("nyte init");

  return {
    async checking(work) {
      const spin = clack.spinner();
      spin.start(`Checking this ${machine}`);
      const result = await work();
      spin.stop(`Checked this ${machine}`);

      return result;
    },
    nothingToDo(plan) {
      clack.note(planLines(plan, ctx).join("\n"), "Nothing to do");

      const start = next().filter(
        (command) => command.startsWith("cd ") || command === "pnpm dev:tui",
      );

      clack.outro(`Already set up. ${start.join(" && ")}`);
    },
    plan(plan) {
      clack.note(planLines(plan, ctx).join("\n"), "Plan");
    },
    async confirm(plan, people) {
      const answer = await clack.confirm({ message: question(plan, people) });

      return answer === true;
    },
    needsPerson(items) {
      clack.log.warn(
        [
          "These steps need a person, and there's no terminal to ask in:",
          ...items.map((item) => `  ${item.title}${item.command ? `: ${item.command}` : ""}`),
        ].join("\n"),
      );
      clack.outro("Run them, then run npx nyte-ai init again.");
    },
    cancelled() {
      clack.cancel("Cancelled. Nothing changed.");
    },
    alreadyDone(step, detail) {
      clack.log.step(`${detail} (already done)`);
    },
    stepStart(step, plan) {
      const title = plan === "" ? step.title : `${step.title}  ${plan}`;
      const spin = clack.spinner({ indicator: "timer" });
      let log;
      let spinning = true;
      spin.start(title);
      finish = (message, ok) => {
        if (log !== undefined) {
          if (ok) log.success(message);
          else log.error(message, { showLog: true });
        } else if (spinning) {
          if (ok) spin.stop(message);
          else spin.error(message);
        } else if (ok) clack.log.step(message);
        else clack.log.error(message);
      };

      return {
        line(text) {
          if (spinning) {
            spin.clear();
            spinning = false;
          }

          log ??= clack.taskLog({ title, limit: 4 });
          log.message(text);
        },
        handOver(message) {
          if (spinning) {
            spin.clear();
            spinning = false;
          }

          clack.log.info(message);
        },
      };
    },
    stepDone(step, detail, ms) {
      finish(`${detail}  ${duration(ms)}`, true);
    },
    stepFailed(step, message) {
      const [first, ...rest] = message.split("\n");
      finish(`${step.title} failed: ${first}`, false);

      if (rest.length > 0) clack.log.message(rest.slice(-12).join("\n"));
      const footer = failureFooter(ctx, step);
      clack.log.message(footer[0]);
      clack.outro(`${footer[1]}\n   ${footer[2]}`);
    },
    stepInterrupted(step) {
      finish(`Stopped during ${step.title}`, false);
      clack.outro("Run npx nyte-ai init again to continue.");
    },
    ready({ ms }) {
      clack.note(next().join("\n"), "Next");
      clack.outro(`Ready in ${duration(ms)}`);
    },
  };
}

/** Plain lines for logs: no color, no cursor movement, one line per event. */
export function plainUI(ctx, next, write = (text) => process.stdout.write(`${text}\n`)) {
  const machine = `${ctx.os.name} ${ctx.os.version}`.trim();
  const name = (step) => step.title.toLowerCase();
  let applying = false;
  write(`nyte init: ${machine} ${ctx.arch}, no terminal`);

  return {
    async checking(work) {
      return work();
    },
    nothingToDo(plan) {
      write("");

      for (const line of planLines(plan, ctx)) write(`  ${line}`);
      write("");
      write("nothing to do");
    },
    plan(plan) {
      write("");
      write("plan");

      for (const line of planLines(plan, ctx)) write(line === "" ? "" : `  ${line}`);
    },
    async confirm() {
      return false;
    },
    needsPerson(items) {
      write("");
      write("These steps need a person, and there's no terminal to ask in:");

      for (const item of items) write(`  ${item.title}${item.command ? `: ${item.command}` : ""}`);
      write("Run them, then run npx nyte-ai init again.");
    },
    cancelled() {
      write("Cancelled. Nothing changed.");
    },
    alreadyDone(step, detail) {
      write(`  ${name(step).padEnd(20)}already done: ${detail}`);
    },
    stepStart(step) {
      if (!applying) {
        write("");
        write("apply");
        applying = true;
      }

      write(`  ${name(step)}: started`);

      return {
        line: (text) => write(`    ${text}`),
        handOver: (message) => write(`    ${message}`),
      };
    },
    stepDone(step, detail, ms) {
      write(`  ${name(step).padEnd(20)}ok  ${duration(ms).padStart(7)}  ${detail}`);
    },
    stepFailed(step, message) {
      write(`  ${name(step).padEnd(20)}failed`);

      for (const line of message.split("\n").slice(-20)) write(`    ${line}`);
      write("");

      for (const line of failureFooter(ctx, step)) write(line);
    },
    stepInterrupted(step) {
      write(`Stopped during ${name(step)}. Run npx nyte-ai init again to continue.`);
    },
    ready({ applied, done, ms }) {
      write("");
      write(`ready: ${applied} applied, ${done} already done, ${duration(ms)}`);
      write("next:");

      for (const command of next()) write(`  ${command}`);
    },
  };
}
