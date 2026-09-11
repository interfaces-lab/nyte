export const HELP = `Run provider-free core benchmarks and emit JSON on stdout.

Usage: pnpm exec node packages/core/benchmark/run.ts [flags]

  --suite <all|projections|histories|sqlite|watch>  Select operations, default all
  --sizes <100,1000,10000>  Select projection sizes, default 100,1000,10000
  --count <20..1000>        Set stored history/object count, default 100
  --events <2..1024>        Set durable notice count, default 300
  --samples <1..30>         Set measured repetitions, default 3
  --warmups <0..10>         Set unmeasured repetitions, default 1
  --help                    Print help and exit

Use --flag value syntax. Duplicate, unknown, and invalid flags are errors.
No stdin, environment configuration, repository data, or providers are used.
`;

export function parseArgs(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--help") return { kind: "help" } as const;
  const flags = new Map<string, string>();
  const allowed = ["--suite", "--sizes", "--count", "--events", "--samples", "--warmups"];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !allowed.includes(flag))
      throw new Error(`Unknown flag: ${flag ?? ""}. Use --help.`);
    if (flags.has(flag)) throw new Error(`Duplicate flag: ${flag}. Provide it once.`);
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}. Use --help.`);
    flags.set(flag, value);
  }
  const integer = (flag: string, fallback: number, minimum: number, maximum: number) => {
    const value = flags.get(flag) ?? String(fallback);
    const parsed = Number(value);
    if (
      !/^\d+$/u.test(value) ||
      !Number.isSafeInteger(parsed) ||
      parsed < minimum ||
      parsed > maximum
    ) {
      throw new Error(`${flag} requires an integer from ${minimum} to ${maximum}.`);
    }
    return parsed;
  };
  const suite = flags.get("--suite") ?? "all";
  if (
    suite !== "all" &&
    suite !== "projections" &&
    suite !== "histories" &&
    suite !== "sqlite" &&
    suite !== "watch"
  ) {
    throw new Error("--suite requires all, projections, histories, sqlite, or watch.");
  }
  const sizes = (flags.get("--sizes") ?? "100,1000,10000").split(",");
  if (
    sizes.some((size) => !["100", "1000", "10000"].includes(size)) ||
    new Set(sizes).size !== sizes.length
  ) {
    throw new Error("--sizes requires distinct comma-separated values from 100,1000,10000.");
  }
  return {
    kind: "run",
    suite,
    sizes: sizes.map(Number),
    count: integer("--count", 100, 20, 1000),
    events: integer("--events", 300, 2, 1024),
    samples: integer("--samples", 3, 1, 30),
    warmups: integer("--warmups", 1, 0, 10),
  } as const;
}
