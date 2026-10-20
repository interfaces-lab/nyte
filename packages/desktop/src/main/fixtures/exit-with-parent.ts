import process from "node:process";
import { app } from "electron";

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
