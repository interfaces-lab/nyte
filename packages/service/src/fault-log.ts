import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Fault } from "@nyte-ai/core";

const ROTATE_AT = 1024 * 1024;
const LINE_MAX = 16 * 1024;

/** Appends one line per fault to `path`, `<ISO time> [<area>] <message> <json>`, cut at 16 KiB, moving the file to `<path>.1` at 1 MiB. Never throws. */
export function openFaultLog(path: string): (fault: Fault) => void {
  return (fault) => {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      rotate(path);
      const line = `${new Date(fault.at).toISOString()} [${fault.area}] ${fault.message} ${fault.data}`;
      const capped =
        line.length > LINE_MAX
          ? `${line.slice(0, LINE_MAX)} … ${String(line.length - LINE_MAX)} more characters`
          : line;
      appendFileSync(path, `${capped.replaceAll(/\r?\n/gu, " ")}\n`, { mode: 0o600 });
    } catch {}
  };
}

function rotate(path: string): void {
  try {
    if (statSync(path).size >= ROTATE_AT) renameSync(path, `${path}.1`);
  } catch {}
}
