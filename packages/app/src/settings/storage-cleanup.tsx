import type { StorageCleanup, StorageGroup, StorageItem, StorageScan } from "@nyte-ai/schema";
import { Button } from "@nyte-ai/ui/button";
import { Loader } from "@nyte-ai/ui/loader";
import { intent } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { props } from "@stylexjs/stylex";
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../contract/errors.ts";
import { connected } from "../data/connection.ts";
import { formatBytes } from "../lib/format.ts";
import { SettingsRow, SettingsSection } from "../settings-rows/rows.tsx";
import { storageStyles } from "./storage-cleanup.stylex.ts";

const scanQuery = queryOptions({
  queryKey: ["host", "storage-scan"],
  queryFn: async () => (await connected()).workspaces.scanStorage(),
  staleTime: 5 * 60_000,
  retry: false,
});

const outcomeQuery = queryOptions({
  queryKey: ["host", "storage-outcome"],
  queryFn: (): Outcome | null => null,
  staleTime: Number.POSITIVE_INFINITY,
});

const CLEAN_KEY = ["host", "storage-clean"] as const;

const ROWS = 6;

const COLUMNS = 36;

const HEAT = [
  storageStyles.heat1,
  storageStyles.heat2,
  storageStyles.heat3,
  storageStyles.heat4,
] as const;

const GROUPS: readonly { readonly id: StorageGroup; readonly title: string }[] = [
  { id: "worktrees", title: "Worktrees" },
  { id: "projects", title: "Project build output" },
  { id: "caches", title: "Tool caches" },
  { id: "nyte", title: "Nyte logs" },
];

type Phase = "scanning" | "ready" | "cleaning" | "cleaned";

type BlockKind = "used" | "heat" | "freed" | "free";

interface Outcome {
  readonly cleanup: StorageCleanup;
  readonly freed: number;
}

export function StorageSection(): ReactElement {
  const queries = useQueryClient();
  const scan = useQuery(scanQuery);
  const outcome = useQuery(outcomeQuery).data ?? null;
  const cleaning = useIsMutating({ mutationKey: CLEAN_KEY }) > 0;

  const clean = useMutation({
    mutationKey: CLEAN_KEY,
    mutationFn: async (ids: readonly string[]) => (await connected()).workspaces.cleanStorage(ids),
    onSuccess: (cleanup) => {
      const cleaned = new Set(cleanup.cleaned);

      const next: Outcome = {
        cleanup,
        freed: (queries.getQueryData(scanQuery.queryKey)?.items ?? [])
          .filter((item) => cleaned.has(item.id))
          .reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      };

      queries.setQueryData(outcomeQuery.queryKey, next);
    },
    onError: (cause) => toast.add({ type: "error", title: errorMessage(cause) }),
  });

  const rescan = (): void => {
    queries.setQueryData(outcomeQuery.queryKey, null);
    void queries.invalidateQueries({ queryKey: scanQuery.queryKey });
  };

  if (scan.error !== null) {
    return (
      <SettingsSection title="Storage">
        <SettingsRow title="Storage can't be measured" description={errorMessage(scan.error)}>
          <Button variant="outline" onClick={rescan}>
            Try Again
          </Button>
        </SettingsRow>
      </SettingsSection>
    );
  }

  const report = scan.isFetching ? null : (scan.data ?? null);
  const ready = (report?.items ?? []).filter((item) => item.blocked === null);
  const total = ready.reduce((sum, item) => sum + (item.bytes ?? 0), 0);

  const phase: Phase =
    report === null ? "scanning" : cleaning ? "cleaning" : outcome === null ? "ready" : "cleaned";

  return (
    <SettingsSection
      title="Storage"
      preview={
        <DiskMeter report={report} ready={ready} total={total} phase={phase} outcome={outcome} />
      }
      note={outcome === null ? undefined : leftAlone(outcome.cleanup, report)}
    >
      <SummaryRow
        phase={phase}
        total={total}
        count={ready.length}
        outcome={outcome}
        onClean={() => clean.mutate(ready.map((item) => item.id))}
        onRescan={rescan}
      />
      {report !== null &&
        GROUPS.map((group) => (
          <GroupRow
            key={group.id}
            title={group.title}
            items={report.items.filter((item) => item.group === group.id)}
            cleaned={outcome?.cleanup.cleaned ?? []}
          />
        ))}
    </SettingsSection>
  );
}

function SummaryRow({
  phase,
  total,
  count,
  outcome,
  onClean,
  onRescan,
}: {
  readonly phase: Phase;
  readonly total: number;
  readonly count: number;
  readonly outcome: Outcome | null;
  readonly onClean: () => void;
  readonly onRescan: () => void;
}): ReactElement {
  if (phase === "scanning") {
    return (
      <SettingsRow title="Measuring space">
        <Loader />
      </SettingsRow>
    );
  }

  if (phase === "cleaned" && outcome !== null) {
    return (
      <SettingsRow
        title={
          <>
            Freed <FreedCount bytes={outcome.freed} />
          </>
        }
      >
        <Button variant="outline" onClick={onRescan}>
          Scan Again
        </Button>
      </SettingsRow>
    );
  }

  if (count === 0) {
    return (
      <SettingsRow title="Nothing to clean">
        <Button variant="outline" onClick={onRescan}>
          Scan Again
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow title={`${formatBytes(total)} can be freed`}>
      <span {...props(storageStyles.control)}>
        <Button variant="ghost" disabled={phase === "cleaning"} onClick={onRescan}>
          Rescan
        </Button>
        <Button variant="solid" loading={phase === "cleaning"} onClick={onClean}>
          Clean Up
        </Button>
      </span>
    </SettingsRow>
  );
}

function GroupRow({
  title,
  items,
  cleaned,
}: {
  readonly title: string;
  readonly items: readonly StorageItem[];
  readonly cleaned: readonly string[];
}): ReactElement | null {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const bytes = items
    .filter((item) => item.blocked === null)
    .reduce((sum, item) => sum + (item.bytes ?? 0), 0);

  return (
    <SettingsRow
      title={title}
      detail={open ? <ItemList items={items} cleaned={cleaned} /> : undefined}
    >
      <span {...props(storageStyles.control)}>
        <span {...props(text.sm, storageStyles.size)}>{formatBytes(bytes)}</span>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={open ? "chevron-down" : "chevron-right"}
          aria-label={open ? `Hide ${title}` : `Show ${title}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
      </span>
    </SettingsRow>
  );
}

function ItemList({
  items,
  cleaned,
}: {
  readonly items: readonly StorageItem[];
  readonly cleaned: readonly string[];
}): ReactElement {
  return (
    <ul {...props(storageStyles.items)}>
      {items.map((item) => (
        <li key={item.id} title={item.path ?? undefined} {...props(storageStyles.item)}>
          <span {...props(storageStyles.itemCopy)}>
            <span
              {...props(
                text.baseCompact,
                storageStyles.itemTitle,
                cleaned.includes(item.id) && storageStyles.itemCleaned,
              )}
            >
              {item.title}
            </span>
            {(item.blocked ?? item.detail) !== "" && (
              <span {...props(text.sm, storageStyles.itemDetail)}>
                {item.blocked ?? item.detail}
              </span>
            )}
          </span>
          <span {...props(text.sm, storageStyles.size)}>
            {item.bytes === null ? null : formatBytes(item.bytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DiskMeter({
  report,
  ready,
  total,
  phase,
  outcome,
}: {
  readonly report: StorageScan | null;
  readonly ready: readonly StorageItem[];
  readonly total: number;
  readonly phase: Phase;
  readonly outcome: Outcome | null;
}): ReactElement {
  const dots = ROWS * COLUMNS;
  const disk = report?.disk ?? null;
  const now = outcome?.cleanup.disk ?? disk;

  const share = (bytes: number): number =>
    disk === null || disk.size === 0 ? 0 : Math.round((bytes / disk.size) * dots);

  const used = disk === null ? 0 : share(disk.size - disk.free);
  const reclaim = Math.min(used, Math.max(total > 0 ? 1 : 0, share(total)));
  const freed = outcome === null ? 0 : Math.min(reclaim, share(outcome.freed));
  const levels = heatLevels(ready, reclaim);

  return (
    <div {...props(storageStyles.meter)}>
      <div {...props(storageStyles.dots)}>
        {Array.from({ length: dots }, (_, index) => {
          const column = Math.floor(index / ROWS);
          const row = index % ROWS;
          const kind = blockKind(index, { used, reclaim, freed, phase });
          const level = levels[index - (used - reclaim)] ?? 0;

          return (
            <span
              key={index}
              {...props(
                (phase === "scanning" || kind === "heat" || kind === "freed") && intent.success,
                storageStyles.dot,
                kind === "used" && storageStyles.used,
                kind === "heat" && HEAT[level],
                phase === "scanning" && storageStyles.scanning,
                phase === "ready" && storageStyles.settling,
                kind === "heat" && phase === "cleaning" && storageStyles.working,
                kind === "freed" && storageStyles.freed,
                storageStyles.delay(
                  blockDelay(phase, kind, { column, row, last: Math.floor((used - 1) / ROWS) }),
                ),
              )}
            />
          );
        })}
      </div>
      <div {...props(text.sm, storageStyles.legend)}>
        <span {...props(storageStyles.legendEntry)}>
          <span {...props(storageStyles.swatch, storageStyles.used)} />
          Used
        </span>
        <span {...props(storageStyles.legendEntry)}>
          <span {...props(storageStyles.ramp)}>
            {HEAT.map((heat, step) => (
              <span key={step} {...props(intent.success, storageStyles.swatch, heat)} />
            ))}
          </span>
          Can be freed
        </span>
        <span {...props(storageStyles.legendEntry)}>
          <span {...props(storageStyles.swatch)} />
          Free
        </span>
        {now !== null && (
          <span {...props(storageStyles.disk)}>
            {`${formatBytes(now.free)} free of ${formatBytes(now.size)}`}
          </span>
        )}
      </div>
    </div>
  );
}

function blockKind(
  index: number,
  state: {
    readonly used: number;
    readonly reclaim: number;
    readonly freed: number;
    readonly phase: Phase;
  },
): BlockKind {
  if (state.phase === "scanning" || index >= state.used) return "free";

  if (index >= state.used - state.freed) return "freed";

  if (index < state.used - state.reclaim || state.phase === "cleaned") return "used";

  return "heat";
}

function blockDelay(
  phase: Phase,
  kind: BlockKind,
  place: { readonly column: number; readonly row: number; readonly last: number },
): number {
  if (phase === "scanning") {
    return place.column * 30 + ((place.row * 37 + place.column * 11) % 7) * 24;
  }

  if (kind === "freed") return (place.last - place.column) * 18;

  return place.column * 6 + place.row * 10 + (kind === "heat" ? 220 : 0);
}

function heatLevels(items: readonly StorageItem[], count: number): readonly number[] {
  const sizes = items
    .flatMap((item) => (item.bytes === null || item.bytes === 0 ? [] : [item.bytes]))
    .toSorted((a, b) => a - b);

  const largest = sizes.at(-1) ?? 0;
  const sum = sizes.reduce((total, size) => total + size, 0);

  const ends = sizes.map((_, index) =>
    sizes.slice(0, index + 1).reduce((total, size) => total + size, 0),
  );

  return Array.from({ length: count }, (_, index) => {
    const position = ((index + 0.5) / count) * sum;
    const size = sizes[ends.findIndex((end) => end >= position)] ?? largest;
    const ratio = largest === 0 ? 1 : size / largest;

    return ratio >= 0.5 ? 3 : ratio >= 0.2 ? 2 : ratio >= 0.06 ? 1 : 0;
  });
}

function FreedCount({ bytes }: { readonly bytes: number }): ReactElement {
  const reduced = useReducedMotion() === true;
  const value = useMotionValue(reduced ? bytes : 0);
  const shown = useTransform(value, (current) => formatBytes(Math.round(current)));

  useMountEffect(() => {
    if (reduced) return;
    const controls = animate(value, bytes, { duration: 1.1, ease: [0.19, 1, 0.22, 1] });

    return () => controls.stop();
  });

  return <motion.span {...props(storageStyles.count)}>{shown}</motion.span>;
}

function leftAlone(cleanup: StorageCleanup, report: StorageScan | null): string | undefined {
  if (cleanup.failed.length === 0) return undefined;
  const titles = new Map((report?.items ?? []).map((item) => [item.id, item.title]));

  const reasons = cleanup.failed.map(
    (failure) => `${titles.get(failure.id) ?? failure.id}: ${failure.reason}`,
  );

  return `Skipped ${reasons.join("; ")}`;
}
