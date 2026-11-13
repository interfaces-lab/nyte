import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import type { Machine, OsProcess } from "@nyte-ai/core";

const TERM_GRACE_MS = 2_000;

const KILL_WAIT_MS = 1_000;

const POLL_MS = 50;

type Seen = { readonly group: number; readonly started: string; readonly exited: boolean };

let booting: Promise<string | null> | undefined;

let self: Promise<Seen | null> | undefined;

/**
 * The machine this host runs on, through the OS's process table. A process is named by its boot, its pid and its start time as the platform reports it: on Linux the start in clock ticks since boot from `/proc/<pid>/stat`, exact; on macOS `ps`'s `lstart` read in UTC, to the second, set once at fork, so two reads of one process always agree and a pid reused within the second it was first taken reads as the same process. The boot is Linux's boot id with this process's pid namespace, so a host in another container never acts on a pid it cannot see, or macOS's boot session. Elsewhere, Windows included, it has no boot and answers `unknown`, so jobs keep today's report there.
 *
 * A token's prefix names how it was read; change the prefix whenever the reading changes, so a token read another way is never taken for a different process.
 */
export const localMachine: Machine = {
  self: () => identifyProcess(process.pid),
  async state(target) {
    const boot = await currentBoot();

    if (boot === null || target.boot !== boot || target.pid <= 1) return "unknown";

    if (!exists(target.pid)) return "gone";
    const seen = await readProcess(target.pid);

    if (seen === null || !sameReading(seen.started, target.started)) return "unknown";

    return seen.exited || seen.started !== target.started ? "gone" : "running";
  },
  async end(target) {
    if (!(await mayAct(target))) return "unknown";

    if (!exists(target.pid)) return exists(-target.group) ? "unknown" : "gone";
    const seen = await readProcess(target.pid);

    if (seen === null || !sameReading(seen.started, target.started)) return "unknown";

    if (seen.started !== target.started) return "gone";

    if (seen.group !== target.group || !signal(-target.group, "SIGTERM")) return "unknown";

    if (await emptied(target.group, TERM_GRACE_MS)) return "ended";

    if (exists(target.pid)) {
      const again = await readProcess(target.pid);

      if (again === null || again.started !== target.started) return "unknown";
    }

    if (!signal(-target.group, "SIGKILL")) return "unknown";

    return (await emptied(target.group, KILL_WAIT_MS)) ? "ended" : "unknown";
  },
};

/** The process `pid` names as this machine identifies it, for a job's record; null where the platform cannot tell or the process is already gone. */
export async function identifyProcess(pid: number): Promise<OsProcess | null> {
  const [boot, seen] = await Promise.all([currentBoot(), readProcess(pid)]);

  return boot === null || seen === null || seen.exited
    ? null
    : { boot, pid, group: seen.group, started: seen.started };
}

/** Whether this host may signal `target` at all: it is on this boot, and neither pid 0 or 1 nor this host's own process or group. */
async function mayAct(target: OsProcess): Promise<boolean> {
  const [boot, own] = await Promise.all([currentBoot(), (self ??= readProcess(process.pid))]);

  return (
    boot !== null &&
    own !== null &&
    target.boot === boot &&
    target.pid > 1 &&
    target.group > 1 &&
    target.pid !== process.pid &&
    target.group !== own.group
  );
}

function currentBoot(): Promise<string | null> {
  booting ??= readBoot().catch(() => null);

  return booting;
}

async function readBoot(): Promise<string | null> {
  if (process.platform === "linux") {
    const [id, namespace] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readlink("/proc/self/ns/pid"),
    ]);

    return `linux:${id.trim()}:${namespace}`;
  }

  if (process.platform !== "darwin") return null;
  const id = (await run("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"])).trim();

  return id === "" ? null : `darwin:${id}`;
}

/** The group and start of `pid`, and whether it has exited and waits to be reaped; null when it cannot be read: no such process, or a table this host cannot read. */
async function readProcess(pid: number): Promise<Seen | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;

  if (process.platform === "linux") {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    const fields = stat?.slice(stat.lastIndexOf(")") + 2).split(" ") ?? [];
    const group = Number(fields[2]);
    const ticks = fields[19];

    return fields[0] === undefined || ticks === undefined
      ? null
      : {
          group,
          started: `linux-stat:${ticks}`,
          exited: fields[0] === "Z" || fields[0] === "X",
        };
  }

  if (process.platform !== "darwin") return null;

  const line = await run("/bin/ps", ["-o", "stat=,pgid=,lstart=", "-p", String(pid)]).catch(
    () => "",
  );

  const match = /^\s*(\S+)\s+(\d+)\s+(.+?)\s*$/.exec(line);

  return match === null
    ? null
    : {
        group: Number(match[2]),
        started: `darwin-lstart-utc:${match[3]?.replace(/\s+/g, " ")}`,
        exited: match[1]?.startsWith("Z") === true,
      };
}

/** Whether two start tokens were read the same way, so that they can be compared at all. */
function sameReading(left: string, right: string): boolean {
  return left.slice(0, left.indexOf(":")) === right.slice(0, right.indexOf(":"));
}

/** Whether a process (or, for a negative pid, a process group) exists: true when signalling it is merely forbidden, false only when the OS says there is none. */
function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name);

    return true;
  } catch {
    return false;
  }
}

async function emptied(group: number, within: number): Promise<boolean> {
  const deadline = Date.now() + within;

  while (exists(-group)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return true;
}

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { TZ: "UTC", LC_ALL: "C" } }, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    );
  });
}
