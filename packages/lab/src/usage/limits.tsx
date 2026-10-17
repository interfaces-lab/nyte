/** The Limits view: every account's usage window, soonest to fill first, tinted by how hot it runs. */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { LimitTrace, TRACE_WIDTH } from "./charts";
import { ACCOUNTS, type Account } from "./fixtures";
import { count, duration, pct, project } from "./format";
import { Cell } from "./cells";
import { styles } from "./page.stylex";

const LIMIT_TINT = { calm: "blue", warm: "yellow", hot: "red" } as const;

function heat(value: number): keyof typeof LIMIT_TINT {
  if (value >= 90) return "hot";

  if (value >= 70) return "warm";

  return "calm";
}

export function LimitsView(): ReactElement {
  const lines = ACCOUNTS.map((account) => ({ account, ...project(account) })).toSorted(
    (a, b) => (a.fillsIn ?? Infinity) - (b.fillsIn ?? Infinity) || b.used - a.used,
  );

  const filling = lines.filter((line) => line.fillsIn !== null);
  const nextReset = lines.toSorted((a, b) => a.resetsIn - b.resetsIn)[0];
  const hottest = lines.toSorted((a, b) => b.used - a.used)[0];

  return (
    <>
      <div {...props(styles.ticker)}>
        <Cell
          label="Windows"
          value={count(lines.length)}
          sub={`${count(new Set(ACCOUNTS.map((a) => a.provider)).size)} providers`}
        />
        <Cell
          label="Fill before reset"
          value={count(filling.length)}
          sub={filling[0] === undefined ? "none" : `first in ${duration(filling[0].fillsIn ?? 0)}`}
          tone={filling.length > 0 ? "bad" : "good"}
        />
        <Cell
          label="Hottest"
          value={pct((hottest?.used ?? 0) / 100)}
          sub={
            hottest === undefined
              ? undefined
              : `${hottest.account.provider} ${hottest.account.window}`
          }
          tone={(hottest?.used ?? 0) >= 90 ? "bad" : "neutral"}
        />
        <Cell
          label="Next reset"
          value={duration(nextReset?.resetsIn ?? 0)}
          sub={
            nextReset === undefined
              ? undefined
              : `${nextReset.account.provider} ${nextReset.account.window}`
          }
        />
        <Cell
          label="Headroom 5H"
          value={pct(
            lines
              .filter((line) => line.account.window === "5h")
              .reduce((sum, line) => sum + (100 - line.used), 0) /
              100 /
              Math.max(1, lines.filter((line) => line.account.window === "5h").length),
          )}
          sub="avg left"
        />
      </div>
      <section aria-label="Windows" {...props(styles.panel)}>
        <div {...props(styles.panelBar)}>
          <span {...props(styles.panelTitle)}>Windows</span>
          <span {...props(styles.grow)} />
          <span {...props(styles.stamp)}>sorted by time to full</span>
        </div>
        <LimitsTable lines={lines} />
      </section>
    </>
  );
}

function LimitsTable({
  lines,
}: {
  readonly lines: readonly (ReturnType<typeof project> & { readonly account: Account })[];
}): ReactElement {
  return (
    <div {...props(styles.tableScroll)}>
      <table {...props(styles.table)}>
        <thead>
          <tr>
            {[
              "Provider",
              "Plan",
              "Window",
              "Used",
              "Left",
              "Pace/H",
              "At reset",
              "Full in",
              "Resets in",
              "Trace",
            ].map((label, index) => (
              <th
                key={label}
                scope="col"
                {...props(styles.th, index >= 4 && index <= 8 && styles.end)}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const tint =
              LIMIT_TINT[
                heat(line.fillsIn === null ? Math.max(line.used, line.atReset * 0.9) : 100)
              ];

            return (
              <tr key={`${line.account.provider}-${line.account.window}`} {...props(styles.tr)}>
                <td {...props(styles.td, styles.strong)}>{line.account.provider}</td>
                <td {...props(styles.td, styles.dim)}>{line.account.plan}</td>
                <td {...props(styles.td)}>{line.account.window}</td>
                <td {...props(styles.td)}>
                  <span {...props(styles.cum)}>
                    <span {...props(styles.cumTrack)}>
                      <span
                        {...props(surfaceTheme[LIMIT_TINT[heat(line.used)]], styles.cumFill)}
                        style={{ width: `${String(line.used)}%` }}
                      />
                    </span>
                    <span
                      {...props(
                        line.used >= 70 && [
                          surfaceTheme[LIMIT_TINT[heat(line.used)]],
                          styles.toned,
                        ],
                      )}
                    >
                      {pct(line.used / 100)}
                    </span>
                  </span>
                </td>
                <td {...props(styles.td, styles.end)}>{pct((100 - line.used) / 100)}</td>
                <td {...props(styles.td, styles.end)}>{line.pacePerHour.toFixed(1)}%</td>
                <td
                  {...props(
                    styles.td,
                    styles.end,
                    line.atReset >= 100 && [intent.danger, styles.toned],
                  )}
                >
                  {line.atReset >= 100 ? "100%+" : pct(line.atReset / 100)}
                </td>
                <td
                  {...props(
                    styles.td,
                    styles.end,
                    line.fillsIn === null
                      ? styles.dim
                      : [intent.danger, styles.toned, styles.strong],
                  )}
                >
                  {line.fillsIn === null ? "—" : duration(line.fillsIn)}
                </td>
                <td {...props(styles.td, styles.end)}>{duration(line.resetsIn)}</td>
                <td {...props(styles.td)} style={{ width: TRACE_WIDTH + 16 }}>
                  <LimitTrace account={line.account} tint={tint} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
