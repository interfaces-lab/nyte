import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { props } from "@stylexjs/stylex";
import { useLayoutEffect, useState, type ReactElement } from "react";
import { Tabs } from "@nyte-ai/ui/tabs";
import { environmentsFor, rowsOf, SURFACES, type Surface } from "./fixtures";
import { boardStyles as styles } from "./environments.stylex";
import { EnvironmentDemo } from "./demo";

const APPEARANCES = ["light", "dark"] as const;
const COUNTS = ["one", "several"] as const;

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <Tabs.Root
      variant="segmented"
      value={value}
      onValueChange={(next: unknown) => {
        const option = options.find(([id]) => id === next);

        if (option !== undefined) onChange(option[0]);
      }}
    >
      <Tabs.List aria-label={label}>
        {options.map(([id, text]) => (
          <Tabs.Tab key={id} value={id}>
            {text}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function EnvironmentsPage(): ReactElement {
  const [appearance, setAppearance] = useState<(typeof APPEARANCES)[number]>("dark");
  const [surface, setSurface] = useState<Surface>("desktop");
  const [count, setCount] = useState<(typeof COUNTS)[number]>("several");
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const [shellSelected, setShellSelected] = useState<string | undefined>("Confirm pairing copy");

  useLayoutEffect(() => {
    applyDisplayMode(appearance === "dark" ? "dark" : "light");
  }, [appearance]);

  const environments = environmentsFor(surface, count === "several");
  const current = environments.find((environment) => environment.id === chosen) ?? environments[0];

  if (current === undefined) throw new Error("Every surface has at least one environment.");

  const home = surface === "desktop" ? "this-mac" : undefined;

  return (
    <main {...props(styles.page)}>
      <header {...props(styles.header)}>
        <h1 {...props(styles.title)}>Environments</h1>
        <span {...props(styles.subtitle)}>
          A badge marks chats running elsewhere, the titlebar says where, and rows on an offline
          machine fade.
        </span>
        <Segmented
          label="Surface"
          options={SURFACES.map((id) => [id, id === "web" ? "Web" : "Desktop"] as const)}
          value={surface}
          onChange={(next) => {
            setSurface(next);
            setChosen(undefined);
          }}
        />
        <Segmented
          label="Connections"
          options={[
            ["one", "One"],
            ["several", "Several"],
          ]}
          value={count}
          onChange={(next) => {
            setCount(next);
            setChosen(undefined);
          }}
        />
        <Segmented
          label="Appearance"
          options={[
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </header>
      <EnvironmentDemo
        key={`demo-${surface}-${count}`}
        environments={environments}
        home={home}
        current={current}
        onChooseEnvironment={setChosen}
        selected={rowsOf(environments).find((row) => row.title === shellSelected)}
        onSelect={(title) => {
          setShellSelected(title);
          setEnvironmentsOpen(false);
        }}
        environmentsOpen={environmentsOpen}
        onNewChat={() => {
          setEnvironmentsOpen(false);
          setShellSelected(undefined);
        }}
        onOpenEnvironments={() => setEnvironmentsOpen(true)}
      />
    </main>
  );
}
