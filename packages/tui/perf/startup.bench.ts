import { bench, tty } from "@hona/strobe";

const ready = 'text="ctrl+p model"';

const warm = "launch with the host running";

export default bench({
  targets: {
    tui: tty(
      [
        "sh",
        "-c",
        'binary="$PWD/packages/tui/dist/nyte" && mkdir -p "$HOME/workspace" && cd "$HOME/workspace" && exec "$binary"',
      ],
      {
        build: "pnpm --dir packages/tui build",
        cols: 120,
        rows: 40,
        ignore: [[20, 8, 90, 21]],
        unset: ["NYTE_*"],
        env: {
          NYTE_HOME: "{home}/.nyte",
          NYTE_SKIP_VERSION_CHECK: "1",
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: "en_US.UTF-8",
        },
        files: { ".nyte/settings.json": { autoUpdate: false, theme: "dark" } },
      },
    ),
  },
  cases: {
    "first launch": {
      primary: "launch.ready",
      metrics: ["launch.composer", "memory.app.private"],
      launch: {
        until: ready,
        milestones: { composer: { match: "enter send", in: "screen" } },
      },
    },
    [warm]: {
      primary: "launch.ready",
      metrics: ["launch.composer", "memory.app.private"],
      launch: {
        until: ready,
        profile: "warm",
        milestones: { composer: { match: "enter send", in: "screen" } },
      },
    },
    "type in the composer": {
      primary: "tty.latency.p95",
      metrics: ["tty.latency.p50", "tty.bytes", "cpu.work"],
      async run({ page }) {
        await page.type("", "hi nyte, every key shows at once");
      },
      async reset({ page }) {
        await page.press("Control+c");
        await page.waitFor('text="Plan, search, build anything"');
      },
    },
  },
  async setup({ page }) {
    await page.waitFor(ready, { timeout: 30_000 });
  },
});
