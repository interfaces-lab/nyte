import type { JSX } from "@opentui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { HealthNotice } from "../../model/screen.ts";
import type { FailureReport, Notice } from "../../model/state.ts";

export function NoticeLine(): JSX.Element {
  const app = useApp();
  const theme = () => app.kit.theme();

  const toneColor = (tone: Notice["tone"]): string => {
    if (tone === "error") return theme().error;

    if (tone === "ok") return theme().ok;

    return tone === "warning" ? theme().warning : theme().dim;
  };

  return (
    <box id="notice" flexDirection="column" flexShrink={0} marginLeft={3} marginRight={2}>
      <Show when={app.screen().health !== null || app.screen().updated !== null}>
        <box id="connection" flexDirection="row" height={1}>
          <Show when={app.screen().health}>
            {(health: Accessor<HealthNotice>) => <HealthText health={health()} />}
          </Show>
          <Show when={app.screen().health !== null && app.screen().updated !== null}>
            <text fg={theme().dim} wrapMode="none" flexShrink={0}>
              {" · "}
            </text>
          </Show>
          <Show when={app.screen().updated}>
            {(updated: Accessor<number>) => (
              <text id="updated" fg={theme().dim} wrapMode="none" flexShrink={1}>
                {`updated ${new Date(updated()).toTimeString().slice(0, 5)}`}
              </text>
            )}
          </Show>
        </box>
      </Show>
      <Show when={app.screen().failure}>
        {(failure: Accessor<FailureReport>) => (
          <text id="failure" fg={theme().error} wrapMode="none">
            {`Something failed in ${failure().origin}: ${failure().message} · ${failure().logPath}`}
          </text>
        )}
      </Show>
      <Show when={app.screen().notice}>
        {(notice: Accessor<Notice>) => (
          <text id="notice-text" fg={toneColor(notice().tone)} wrapMode="none">
            {notice().text}
          </text>
        )}
      </Show>
    </box>
  );
}

const CLOCK_INTERVAL_MS = 1_000;

function HealthText(props: { readonly health: HealthNotice }): JSX.Element {
  const app = useApp();
  const [now, setNow] = createSignal(app.kit.now());

  createEffect(() => {
    if (props.health.kind !== "reconnecting") return;
    const tick = app.kit.ticker(CLOCK_INTERVAL_MS);

    createEffect(() => {
      tick();
      setNow(app.kit.now());
    });
  });

  return (
    <text id="health" fg={app.kit.theme().warning} wrapMode="none" flexShrink={0}>
      {healthText(props.health, now())}
    </text>
  );
}

function healthText(health: HealthNotice, now: number): string {
  switch (health.kind) {
    case "reconnecting":
      return `Reconnecting in ${String(Math.max(1, Math.ceil((health.at - now) / 1_000)))}s`;
    case "unreachable":
      return "Can't reach host";
    case "signed-out":
      return "Sign in again";
    case "outdated":
      return "Update Nyte";
    default: {
      const _exhaustive: never = health;

      return _exhaustive;
    }
  }
}
