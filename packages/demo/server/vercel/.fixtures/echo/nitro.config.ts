import process from "node:process";
import { defineConfig } from "nitro";
import workflowNitro, { type ModuleOptions } from "workflow/nitro";

const config = {
  serverDir: "./src",
  modules: [workflowNitro],
  workflow: {
    runtime: "nodejs24.x",
    dirs: ["./src", "./workflows"],
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
          path: "/v1/reconcile",
          schedule: process.env.NYTE_RECONCILE_SCHEDULE ?? "* * * * *",
        },
      ],
    },
  },
} satisfies Parameters<typeof defineConfig>[0] & { workflow: ModuleOptions };

export default defineConfig(config);
