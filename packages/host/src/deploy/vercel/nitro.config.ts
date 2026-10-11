import process from "node:process";
import { defineConfig } from "nitro";
import workflowNitro from "workflow/nitro";
import type { ModuleOptions } from "workflow/nitro";

const config = {
  serverDir: "./server",
  modules: [workflowNitro],
  workflow: {
    runtime: "nodejs24.x",
    dirs: ["./server/workflows"],
  },
  vercel: {
    functions: {
      runtime: "nodejs24.x",
      maxDuration: 300,
    },
    config: {
      version: 3,
      crons: [
        {
          path: "/.nyte/repair",
          schedule: process.env.NYTE_REPAIR_SCHEDULE ?? "* * * * *",
        },
      ],
    },
  },
} satisfies Parameters<typeof defineConfig>[0] & { workflow: ModuleOptions };

/** The Nitro app the Vercel deploy builds (`nitro build --preset vercel`, §42m): routes and utilities under `server/`, the `workflow/nitro` integration compiling the `"use workflow"`/`"use step"` functions in `server/workflows` for the `nodejs24.x` runtime, functions up to 300 s, and the repair cron on `/.nyte/repair` every minute (`NYTE_REPAIR_SCHEDULE` overrides it; Hobby plans allow a daily schedule only). */
export default defineConfig(config);
