import process from "node:process";
import { defineConfig } from "nitro";
import type { ModuleOptions } from "workflow/nitro";

const config = {
  serverDir: "./server",
  modules: ["workflow/nitro"],
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

export default defineConfig(config);
