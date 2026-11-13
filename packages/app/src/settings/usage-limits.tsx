import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { providerIcon } from "../chat/composer/model-picker-state.ts";
import { useAccountLimits } from "../data/usage.ts";
import { Bone, focusRing } from "./usage-parts.tsx";
import { usageStyles } from "./usage-settings.stylex.ts";
import { deriveAccount, type AccountLimits, type LimitMeter } from "./usage-view.ts";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

const LIMIT_WARM_PERCENT = 70;

const LIMIT_HOT_PERCENT = 90;

const styles = create({
  account: { flex: "1 1 12rem", gap: space.s2 },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    color: role.contentTertiary,
  },
  name: { color: role.contentPrimary, fontWeight: type.weightMedium },
  plan: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  icon: { flexShrink: 0, color: role.contentSecondary },
  meters: { display: "flex", flexDirection: "column", gap: space.s2 },
  meter: { display: "flex", flexDirection: "column", gap: space.s1 },
  line: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: space.s1_5,
    minWidth: 0,
  },
  label: { color: role.contentSecondary, overflowWrap: "break-word" },
  reset: { ...figure, color: role.contentTertiary, whiteSpace: "nowrap" },
  value: {
    ...figure,
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    marginInlineStart: "auto",
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
    whiteSpace: "nowrap",
  },
  hot: { color: role.contentAccent },
  track: {
    position: "relative",
    display: "block",
    height: 4,
    overflow: "clip",
    borderRadius: 2,
    backgroundColor: role.fillTertiary,
  },
  fill: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    width: "100%",
    transformOrigin: "left center",
    backgroundColor: role.contentSecondary,
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  fillHot: { backgroundColor: role.chartSeries },
  message: { margin: 0, color: role.contentTertiary },
});

/** A card per signed-in plan, beside the spend card; nothing at all when no plan reports limits. */
export function LimitCards(): ReactElement | null {
  const limits = useAccountLimits();

  const accounts = limits.data
    ?.map((usage) => deriveAccount(usage, limits.dataUpdatedAt))
    .filter((account) => account !== null);

  const refresh = (
    <Button
      variant="text"
      size="2xs"
      iconOnly
      icon="refresh"
      aria-label="Refresh Plan Limits"
      loading={limits.isFetching}
      onClick={() => void limits.refetch({ cancelRefetch: false })}
    />
  );

  if (accounts === undefined) {
    if (limits.error === null) {
      return (
        <div aria-busy="true" {...props(usageStyles.card, styles.account)}>
          <Bone width={112} height={12} />
          <Bone width="100%" height={4} />
          <Bone width="100%" height={4} />
        </div>
      );
    }

    return (
      <section aria-label="Plan limits" {...props(usageStyles.card, styles.account)}>
        <span {...props(text.sm, styles.head)}>
          <span {...props(styles.name, styles.plan)}>Plan limits</span>
          {refresh}
        </span>
        <p role="alert" {...props(text.xs, styles.message)}>
          Couldn&apos;t read plan limits. {limits.error.message}
        </p>
      </section>
    );
  }

  return (
    <>
      {accounts.map((account, index) => (
        <AccountCard key={account.key} account={account} action={index === 0 ? refresh : null} />
      ))}
    </>
  );
}

function AccountCard({
  account,
  action,
}: {
  readonly account: AccountLimits;
  readonly action: ReactElement | null;
}): ReactElement {
  return (
    <section
      aria-label={`${account.name}${account.account === undefined ? "" : ` ${account.account}`} limits`}
      {...props(usageStyles.card, styles.account)}
    >
      <span {...props(text.sm, styles.head)}>
        <Icon name={providerIcon(account.provider)} size="sm" {...props(styles.icon)} />
        <span {...props(styles.name)}>{account.name}</span>
        <span {...props(styles.plan)}>{account.account}</span>
        {action}
      </span>
      {account.message !== undefined && (
        <p role={account.failed ? "alert" : undefined} {...props(text.xs, styles.message)}>
          {account.message}
        </p>
      )}
      {account.meters.length > 0 && (
        <div {...props(styles.meters)}>
          {account.meters.map((meter) => (
            <LimitMeterRow key={meter.key} meter={meter} account={account.name} />
          ))}
        </div>
      )}
    </section>
  );
}

function LimitMeterRow({
  meter,
  account,
}: {
  readonly meter: LimitMeter;
  readonly account: string;
}): ReactElement {
  const tier =
    meter.used >= LIMIT_HOT_PERCENT ? "hot" : meter.used >= LIMIT_WARM_PERCENT ? "warm" : "calm";

  const tone = tier === "hot" ? intent.danger : tier === "warm" ? intent.warning : undefined;

  return (
    <div
      role="meter"
      aria-label={`${account} ${meter.label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={meter.used}
      aria-valuetext={`${String(meter.used)}% used${tier === "calm" ? "" : ", near the limit"}. ${meter.resetsAt}`}
      {...props(styles.meter)}
    >
      <span {...props(text.sm, styles.line)}>
        <span {...props(styles.label)}>{meter.label}</span>
        {meter.resetsIn !== "" && (
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} {...props(styles.reset, focusRing)} />}>
              {meter.resetsIn}
            </TooltipTrigger>
            <TooltipContent>{meter.resetsAt}</TooltipContent>
          </Tooltip>
        )}
        <span {...props(tone, styles.value, tone !== undefined && styles.hot)}>
          {tone !== undefined && <Icon name="warning" size="xs" />}
          {String(meter.used)}%
        </span>
      </span>
      <span aria-hidden="true" {...props(styles.track)}>
        <span
          {...props(tone, styles.fill, tone !== undefined && styles.fillHot)}
          style={{ transform: `scaleX(${String(Math.min(meter.used, 100) / 100)})` }}
        />
      </span>
    </div>
  );
}
