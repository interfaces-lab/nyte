import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { shellCard } from "../../lib/tool-card.ts";
import type { ShellJob } from "../../model/state.ts";
import { CardView } from "./card.tsx";
import { useTranscript } from "./scope.tsx";

const CLOCK_INTERVAL_MS = 1_000;

export function ShellCard(props: { readonly job: ShellJob }): JSX.Element {
  const { kit } = useApp();
  const scope = useTranscript();
  const [now, setNow] = createSignal(props.job.startedAt);

  createEffect(() => {
    if (props.job.state.kind !== "running") return;
    const tick = kit.ticker(CLOCK_INTERVAL_MS);

    createEffect(() => {
      tick();
      setNow(kit.now());
    });
  });

  const card = createMemo(() =>
    shellCard(props.job, now(), scope.model().toolOutput === "expanded"),
  );

  return <CardView id={`shell:${props.job.id}`} card={card()} />;
}
