// Test-only preload: the working tree renamed SessionFollower to SessionObserver in core
// while the TUI still imports the old name. Not part of the change.
import { plugin } from "bun";
plugin({
  name: "session-follower-alias",
  setup(build) {
    build.onLoad({ filter: /packages\/core\/src\/client\.ts$/ }, async (args) => {
      const text = await Bun.file(args.path).text();
      return {
        contents: `${text}\nexport { SessionObserver as SessionFollower } from "./client/session-follow.ts";\n`,
        loader: "ts",
      };
    });
  },
});
