import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const statsUrl = "https://nyte-metrics.daniel-fu90.workers.dev/v1/stats";

const count = z.number().int().nonnegative();

const day = z.iso.date();

const usage = {
  requests: count,
  input: count,
  output: count,
  cost: z.number().nonnegative(),
};

const usageStatsSchema = z.object({
  updated: z.iso.datetime({ offset: true }),
  days: count,
  installs: z.array(z.object({ day, installs: count, updates: count })),
  active: z.array(z.object({ day, count })),
  versions: z.array(z.object({ version: z.string(), count })),
  platforms: z.array(z.object({ os: z.string(), arch: z.string(), count })),
  clients: z.array(z.object({ client: z.string(), count })),
  providers: z.array(z.object({ provider: z.string(), ...usage })),
  models: z.array(z.object({ provider: z.string(), model: z.string(), ...usage })),
  tokens: z.array(z.object({ day, provider: z.string(), tokens: count })),
});

export type UsageStats = z.infer<typeof usageStatsSchema>;

export const loadUsageStats = createServerFn().handler(async () => {
  const response = await fetch(statsUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null);

  if (!response?.ok) return null;

  const body: unknown = await response.json().catch(() => null);

  const parsed = usageStatsSchema.safeParse(body);

  return parsed.success ? parsed.data : null;
});
