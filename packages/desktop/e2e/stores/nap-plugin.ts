import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE = `import process from "node:process";

const parameters = {
  "~standard": {
    version: 1,
    vendor: "harness",
    validate: (value) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] }),
      output: () => ({ type: "string" }),
    },
  },
};

export default {
  id: "harness-nap",
  contribute: {
    tools: [
      {
        name: "nap",
        description: "Wait on a durable timer for the given seconds.",
        parameters,
        replay: "safe",
        effects: "none",
        approval: "never",
        class: () => ({ kind: "custom", label: "nap" }),
        async execute(args, invocation) {
          const until = (await invocation.memo("until", () => Date.now() + args.seconds * 1000));
          const outcome = await invocation.wait({ kind: "timer", until });

          return { content: [{ kind: "text", text: "napped " + outcome.kind }] };
        },
      },
      {
        name: "background",
        description: "Start a shell command as a background job of this chat.",
        parameters,
        replay: "never",
        effects: "none",
        approval: "never",
        class: () => ({ kind: "custom", label: "background" }),
        async execute(args, invocation) {
          const job = await invocation.workspace.jobs.start({
            command: "echo started >> " + JSON.stringify(process.env.NYTE_HARNESS_MARKS ?? "/dev/null") + "; sleep " + String(args.seconds) + "; echo finished",
            session: invocation.session.id,
            title: "harness job",
          });

          return { content: [{ kind: "text", text: "started " + job.id }] };
        },
      },
    ],
  },
};
`;

export async function installNap(home: string): Promise<void> {
  const folder = join(home, ".nyte", "plugins", "harness-nap");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "index.js"), SOURCE);
}
