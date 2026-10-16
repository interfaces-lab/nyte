const HOUR = 3_600_000;

const DAY = 24 * HOUR;

const TODAY = Date.UTC(2026, 2, 16);

const NOW = TODAY + 16 * HOUR;

const HISTORY_DAYS = 180;

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;

  return value - Math.floor(value) - 0.5;
}

export const TOKEN_KINDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

export const TOKEN_LABELS = {
  input: "Input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
} as const satisfies Readonly<Record<TokenKind, string>>;

type PerKind = Readonly<Record<TokenKind, number>>;

export interface Model {
  readonly id: string;
  readonly provider: string;
  readonly share: number;
  readonly rate: PerKind;
  readonly mix: PerKind;
  readonly perTurn: number;
}

export const MODELS: readonly Model[] = [
  {
    id: "claude-opus-4-6",
    provider: "Anthropic",
    share: 0.43,
    rate: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    mix: { input: 0.04, output: 0.015, cacheRead: 0.9, cacheWrite: 0.045 },
    perTurn: 0.29,
  },
  {
    id: "gpt-5.6-sol",
    provider: "OpenAI",
    share: 0.218,
    rate: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    mix: { input: 0.08, output: 0.02, cacheRead: 0.88, cacheWrite: 0.02 },
    perTurn: 0.33,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "Anthropic",
    share: 0.169,
    rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    mix: { input: 0.05, output: 0.015, cacheRead: 0.89, cacheWrite: 0.045 },
    perTurn: 0.12,
  },
  {
    id: "gemini-3-pro",
    provider: "Google",
    share: 0.069,
    rate: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 },
    mix: { input: 0.1, output: 0.02, cacheRead: 0.86, cacheWrite: 0.02 },
    perTurn: 0.14,
  },
  {
    id: "claude-haiku-4-5",
    provider: "Anthropic",
    share: 0.043,
    rate: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    mix: { input: 0.06, output: 0.02, cacheRead: 0.88, cacheWrite: 0.04 },
    perTurn: 0.03,
  },
  {
    id: "gpt-5-mini",
    provider: "OpenAI",
    share: 0.03,
    rate: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 },
    mix: { input: 0.12, output: 0.03, cacheRead: 0.83, cacheWrite: 0.02 },
    perTurn: 0.02,
  },
  {
    id: "kimi-k2",
    provider: "Moonshot",
    share: 0.022,
    rate: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0.6 },
    mix: { input: 0.2, output: 0.04, cacheRead: 0.74, cacheWrite: 0.02 },
    perTurn: 0.05,
  },
  {
    id: "deepseek-v4",
    provider: "DeepSeek",
    share: 0.012,
    rate: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
    mix: { input: 0.18, output: 0.04, cacheRead: 0.76, cacheWrite: 0.02 },
    perTurn: 0.02,
  },
  {
    id: "qwen3-coder",
    provider: "Alibaba",
    share: 0.007,
    rate: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
    mix: { input: 0.22, output: 0.05, cacheRead: 0.71, cacheWrite: 0.02 },
    perTurn: 0.02,
  },
];

export interface Group {
  readonly id: string;
  readonly detail: string;
  readonly share: number;
}

export const SOURCES: readonly Group[] = [
  { id: "Claude Code", detail: "~/.claude", share: 0.41 },
  { id: "Nyte", detail: "local", share: 0.27 },
  { id: "Codex", detail: "~/.codex", share: 0.22 },
  { id: "Cursor", detail: "dashboard API", share: 0.07 },
  { id: "Gemini CLI", detail: "~/.gemini", share: 0.03 },
];

export const PROJECTS: readonly Group[] = [
  { id: "nyte", detail: "~/Developer/nyte", share: 0.52 },
  { id: "uji-desktop", detail: "~/Developer/uji-desktop", share: 0.21 },
  { id: "paper-plugins", detail: "~/Developer/paper-plugins", share: 0.11 },
  { id: "dotfiles", detail: "~/dotfiles", share: 0.07 },
  { id: "blog", detail: "~/Sites/blog", share: 0.05 },
  { id: "scratch", detail: "~/scratch", share: 0.04 },
];

export interface Tally {
  readonly cost: PerKind;
  readonly tokens: PerKind;
  readonly saved: number;
  readonly turns: number;
}

export const EMPTY: Tally = {
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  saved: 0,
  turns: 0,
};

function perKind(read: (kind: TokenKind) => number): PerKind {
  return {
    input: read("input"),
    output: read("output"),
    cacheRead: read("cacheRead"),
    cacheWrite: read("cacheWrite"),
  };
}

export function add(a: Tally, b: Tally): Tally {
  return {
    cost: perKind((kind) => a.cost[kind] + b.cost[kind]),
    tokens: perKind((kind) => a.tokens[kind] + b.tokens[kind]),
    saved: a.saved + b.saved,
    turns: a.turns + b.turns,
  };
}

export function scale(tally: Tally, by: number): Tally {
  return {
    cost: perKind((kind) => tally.cost[kind] * by),
    tokens: perKind((kind) => tally.tokens[kind] * by),
    saved: tally.saved * by,
    turns: tally.turns * by,
  };
}

export const sumKinds = (values: PerKind): number =>
  values.input + values.output + values.cacheRead + values.cacheWrite;

function priced(model: Model, cost: number, seed: number): Tally {
  const drift = perKind(
    (kind) => model.mix[kind] * (kind === "cacheRead" ? 1 + 0.08 * noise(seed) : 1),
  );

  const mix = perKind((kind) => drift[kind] / sumKinds(drift));
  const blended = sumKinds(perKind((kind) => mix[kind] * model.rate[kind]));
  const tokens = perKind((kind) => (cost / blended) * mix[kind] * 1e6);

  return {
    cost: perKind((kind) => (tokens[kind] / 1e6) * model.rate[kind]),
    tokens,
    saved: (tokens.cacheRead / 1e6) * (model.rate.input - model.rate.cacheRead),
    turns: cost / model.perTurn,
  };
}

function split(shares: readonly number[], seed: number): number[] {
  const raw = shares.map((share, index) => share * (1 + 0.6 * noise(seed * 31 + index * 7)));
  const total = raw.reduce((sum, value) => sum + value, 0);

  return raw.map((value) => value / total);
}

function daySpend(day: number): number {
  const weekday = new Date(TODAY - (HISTORY_DAYS - day) * DAY).getUTCDay();
  const rhythm = weekday === 0 || weekday === 6 ? 0.55 : 1;

  return 9 * (1 + day * 0.006) * rhythm * (1 + 0.7 * noise(day));
}

function hourWeight(hour: number): number {
  return 0.08 + Math.exp(-((hour - 14) ** 2) / 18);
}

export interface Bucket {
  readonly start: number;
  readonly models: readonly Tally[];
}

function bucket(start: number, spend: number, seed: number): Bucket {
  const weights = split(
    MODELS.map((model) => model.share),
    seed,
  );

  return {
    start,
    models: MODELS.map((model, index) =>
      priced(model, spend * (weights[index] ?? 0), seed * 13 + index),
    ),
  };
}

const DAILY: readonly Bucket[] = Array.from({ length: HISTORY_DAYS }, (_slot, day) =>
  bucket(TODAY - (HISTORY_DAYS - day) * DAY, daySpend(day), day),
);

const HOURLY: readonly Bucket[] = Array.from({ length: 48 }, (_slot, index) => {
  const start = NOW - (48 - index) * HOUR;
  const hour = new Date(start).getUTCHours();
  const total = Array.from({ length: 24 }, (_hour, h) => hourWeight(h)).reduce((a, b) => a + b, 0);

  return bucket(
    start,
    daySpend(HISTORY_DAYS - 1 - Math.floor((47 - index) / 24)) * (hourWeight(hour) / total),
    1000 + index,
  );
});

export const PERIODS = [
  { key: "24h", label: "24H", buckets: 24, unit: "hour" },
  { key: "7d", label: "7D", buckets: 7, unit: "day" },
  { key: "30d", label: "30D", buckets: 30, unit: "day" },
  { key: "90d", label: "90D", buckets: 90, unit: "day" },
] as const;

export type Period = (typeof PERIODS)[number];

export function slicePeriod(period: Period) {
  const source = period.unit === "hour" ? HOURLY : DAILY;

  return {
    current: source.slice(-period.buckets),
    previous: source.slice(-period.buckets * 2, -period.buckets),
  };
}

export const GROUPINGS = [
  { key: "model", label: "Model" },
  { key: "source", label: "Source" },
  { key: "project", label: "Project" },
] as const;

export type Grouping = (typeof GROUPINGS)[number]["key"];

export interface Row {
  readonly id: string;
  readonly detail: string;
  readonly series: readonly Tally[];
}

const total = (tallies: readonly Tally[]): Tally => tallies.reduce(add, EMPTY);

export function rows(grouping: Grouping, buckets: readonly Bucket[]): Row[] {
  if (grouping === "model") {
    return MODELS.map((model, index) => ({
      id: model.id,
      detail: model.provider,
      series: buckets.map((b) => b.models[index] ?? EMPTY),
    }));
  }

  const groups = grouping === "source" ? SOURCES : PROJECTS;

  return groups.map((group, index) => ({
    id: group.id,
    detail: group.detail,
    series: buckets.map((b) =>
      scale(
        total(b.models),
        split(
          groups.map((g) => g.share),
          b.start / HOUR + (grouping === "source" ? 0 : 500),
        )[index] ?? 0,
      ),
    ),
  }));
}

export const bucketTotal = (b: Bucket): Tally => total(b.models);

export const seriesTotal = total;

export interface Account {
  readonly provider: string;
  readonly plan: string;
  readonly window: "5h" | "week" | "month";
  readonly samples: readonly number[];
  readonly steps: number;
  readonly stepMinutes: number;
}

export const ACCOUNTS: readonly Account[] = [
  {
    provider: "Codex",
    plan: "Pro",
    window: "5h",
    samples: [0, 8, 15, 26, 38, 50, 63, 77, 91],
    steps: 10,
    stepMinutes: 30,
  },
  {
    provider: "Codex",
    plan: "Pro",
    window: "week",
    samples: [0, 8, 17, 24, 33, 41, 52, 61, 72],
    steps: 14,
    stepMinutes: 720,
  },
  {
    provider: "Claude",
    plan: "Max 20x",
    window: "5h",
    samples: [0, 9, 16, 22, 31, 40, 48, 55, 64],
    steps: 10,
    stepMinutes: 30,
  },
  {
    provider: "Claude",
    plan: "Max 20x",
    window: "week",
    samples: [0, 5, 9, 14, 19, 23, 27, 31, 38],
    steps: 14,
    stepMinutes: 720,
  },
  {
    provider: "Cursor",
    plan: "Ultra",
    window: "month",
    samples: [0, 6, 13, 19, 27, 33, 41, 46],
    steps: 30,
    stepMinutes: 1440,
  },
  {
    provider: "Gemini",
    plan: "AI Pro",
    window: "5h",
    samples: [0, 2, 3, 5, 6, 8],
    steps: 10,
    stepMinutes: 30,
  },
];

export const NOW_AT = NOW;
