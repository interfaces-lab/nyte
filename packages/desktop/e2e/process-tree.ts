import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

/** One process of a tree `inspectProcessTree` read. */
export interface TreeProcess {
  readonly pid: number;
  readonly parent: number;
  readonly residentBytes: number;
  readonly command: string;
}

/** Counts the Electron process and every descendant, with their resident memory, via ps. */
export async function inspectProcessTree(
  root: number | undefined,
): Promise<readonly TreeProcess[] | null> {
  if (root === undefined || process.platform === "win32") return null;
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="]);

  const rows = stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);

    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            residentBytes: Number(match[3]) * 1_024,
            command: match[4] ?? "",
          },
        ];
  });

  const tree = new Set([root]);
  let grew = true;

  while (grew) {
    grew = false;

    for (const row of rows) {
      if (tree.has(row.pid) || !tree.has(row.parent)) continue;
      tree.add(row.pid);
      grew = true;
    }
  }

  return rows.filter((row) => tree.has(row.pid));
}

export async function treeTotals(root: number | undefined) {
  const tree = (await inspectProcessTree(root)) ?? [];

  return { processes: tree.length, rss: tree.reduce((total, row) => total + row.residentBytes, 0) };
}

export async function cpuSeconds(
  root: number | undefined,
): Promise<ReadonlyMap<number, { command: string; seconds: number }>> {
  const tree = new Set((await inspectProcessTree(root))?.map((row) => row.pid) ?? []);
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,time=,comm="]);

  return new Map(
    stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+([\d:.]+)\s+(.*)$/u.exec(line);

      if (match === null || !tree.has(Number(match[1]))) return [];

      const seconds = (match[2] ?? "0")
        .split(":")
        .reduce((total, part) => total * 60 + Number(part), 0);

      return [[Number(match[1]), { command: match[3] ?? "", seconds }]];
    }),
  );
}

/**
 * The processes of `tree` still running after `graceMs`: none once Electron has quit and reaped
 * its helpers, so any left, such as the Nyte Host utility process or a child it spawned, outlived
 * the app. Checks every 100 ms and returns as soon as all are gone.
 */
export async function survivors(
  tree: readonly TreeProcess[],
  graceMs: number,
): Promise<readonly TreeProcess[]> {
  const deadline = performance.now() + graceMs;
  let alive = tree.filter(running);

  while (alive.length > 0 && performance.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
    alive = alive.filter(running);
  }

  return alive;
}

function running(row: TreeProcess): boolean {
  try {
    process.kill(row.pid, 0);

    return true;
  } catch (cause) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
  }
}
