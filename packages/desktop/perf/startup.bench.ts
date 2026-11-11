import { app, bench } from "@hona/strobe";

const composer = '[aria-label="Message"][contenteditable="true"]';

const milestones = {
  shell: { match: "nyte:shell-ready", in: "page" },
  connected: { match: "nyte:sdk-connected", in: "page" },
} as const;

export default bench({
  targets: { desktop: app("nyte") },
  cases: {
    "first launch": {
      primary: "launch.ready",
      metrics: ["launch.shell", "launch.painted", "memory.app.private"],
      launch: { until: composer, milestones: { shell: milestones.shell } },
    },
    "launch with a warm profile": {
      primary: "launch.ready",
      metrics: ["launch.shell", "launch.connected", "launch.painted", "memory.app.private"],
      launch: { until: composer, profile: "warm", milestones },
    },
  },
});
