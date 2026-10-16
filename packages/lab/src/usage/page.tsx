import { props } from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { NOW_AT, PERIODS, type Period } from "./fixtures";
import { LimitsView } from "./limits";
import { styles } from "./page.stylex";
import { SpendView } from "./spend";

const VIEWS = [
  { key: "cost", label: "Cost", hotkey: "c" },
  { key: "tokens", label: "Tokens", hotkey: "t" },
  { key: "limits", label: "Limits", hotkey: "l" },
] as const;

type View = (typeof VIEWS)[number]["key"];

const SCHEMES = [
  ["system", "Auto", "light dark"],
  ["light", "Light", "light"],
  ["dark", "Dark", "dark"],
] as const;

type Scheme = (typeof SCHEMES)[number][0];

const asOf = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
}).format(NOW_AT);

export function UsagePage(): ReactElement {
  const [scheme, setScheme] = useState<Scheme>("system");
  const [view, setView] = useState<View>("cost");
  const [period, setPeriod] = useState<Period>(PERIODS[1]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.colorScheme =
      SCHEMES.find(([name]) => name === scheme)?.[2] ?? "light dark";

    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [scheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select") !== null)
      )
        return;

      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const next = PERIODS[Number(event.code.replace("Digit", "")) - 1];

        if (next === undefined) return;

        event.preventDefault();
        setPeriod(next);

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") setSelected(null);

      const next = VIEWS.find((item) => item.hotkey === event.key.toLowerCase());

      if (next !== undefined) setView(next.key);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.frame)}>
        <header {...props(styles.bar)}>
          <h1 {...props(styles.title)}>Usage</h1>
          <Tabs.Root
            variant="segmented"
            value={view}
            onValueChange={(value) => {
              const next = VIEWS.find((item) => item.key === value);

              if (next !== undefined) setView(next.key);
            }}
          >
            <Tabs.List aria-label="View">
              {VIEWS.map((item) => (
                <Tabs.Tab key={item.key} value={item.key}>
                  {item.label}
                  <Kbd keys={[item.hotkey.toUpperCase()]} plain />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <span {...props(styles.grow)} />
          {view !== "limits" && (
            <ToggleGroup
              aria-label="Period"
              value={[period.key]}
              onValueChange={(values) => {
                const next = PERIODS.find((item) => item.key === values[0]);

                if (next !== undefined) setPeriod(next);
              }}
            >
              {PERIODS.map((item) => (
                <Toggle key={item.key} value={item.key} size="sm">
                  {item.label}
                </Toggle>
              ))}
            </ToggleGroup>
          )}
          <ToggleGroup
            aria-label="Appearance"
            value={[scheme]}
            onValueChange={(values) => {
              const next = SCHEMES.find(([name]) => name === values[0]);

              if (next !== undefined) setScheme(next[0]);
            }}
          >
            {SCHEMES.map(([name, label]) => (
              <Toggle key={name} value={name} size="sm">
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
          <span {...props(styles.stamp)}>{asOf} UTC</span>
        </header>

        {view === "limits" ? (
          <LimitsView />
        ) : (
          <SpendView metric={view} period={period} selected={selected} onSelect={setSelected} />
        )}
      </div>
    </main>
  );
}
