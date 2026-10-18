import process from "node:process";
import { app } from "electron";

/** End this Electron fixture once the test that spawned it is gone. Windows gives a GUI process no usable stdin to watch. */
export function exitWithParent(): void {
  const parent = process.ppid;

  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      app.exit(1);
    }
  }, 1_000).unref();
}
