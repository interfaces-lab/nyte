import process from "node:process";
import { defineConfig } from "nitro";
import workflowNitro, { type ModuleOptions } from "workflow/nitro";

const config = {
  serverDir: "./src",
  modules: [workflowNitro],
  workflow: {
    runtime: "nodejs24.x",
    // Generated preview apps must never register workflows in the production build.
    dirs: ["./src", "./workflows"],
  },
  vercel: {
    functions: {
      runtime: "nodejs24.x",
      maxDuration: 300,
    },
    config: {
      version: 3,
      // Orphaned dispatch obligations are repaired without a client returning.
      crons: [
        {
          path: "/v1/reconcile",
          // Hobby accepts only daily schedules; set NYTE_RECONCILE_SCHEDULE="0 4 * * *" at build.
          schedule: process.env.NYTE_RECONCILE_SCHEDULE ?? "* * * * *",
        },
      ],
    },
  },
} satisfies Parameters<typeof defineConfig>[0] & { workflow: ModuleOptions };

export default defineConfig(config);
