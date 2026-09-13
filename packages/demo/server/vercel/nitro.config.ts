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
  },
} satisfies Parameters<typeof defineConfig>[0] & { workflow: ModuleOptions };

export default defineConfig(config);
