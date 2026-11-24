import type { JSX } from "@opentui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { HostNotice } from "../../model/screen.ts";
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
      <Show when={app.screen().host !== null || app.screen().updated !== null}>
        <box id="connection" flexDirection="row" height={1}>
          <Show when={app.screen().host}>
            {(host: Accessor<HostNotice>) => <HostText host={host()} />}
          </Show>
          <Show when={app.screen().host !== null && app.screen().updated !== null}>
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

const CLOCK_INTERVAL_MS = 1000;

function HostText(props: { readonly host: HostNotice }): JSX.Element {
  const app = useApp();
  const [now, setNow] = createSignal(app.kit.now());

  createEffect(() => {
    if (props.host.kind !== "reconnecting") return;
    const tick = app.kit.ticker(CLOCK_INTERVAL_MS);

    createEffect(() => {
      tick();
      setNow(app.kit.now());
    });
  });

  return (
    <text id="health" fg={app.kit.theme().warning} wrapMode="none" flexShrink={0}>
      {hostText(props.host, now())}
    </text>
  );
}

function hostText(host: HostNotice, now: number): string {
  switch (host.kind) {
    case "reconnecting":
      return `Reconnecting in ${String(Math.max(1, Math.ceil((host.at - now) / 1000)))}s`;
    case "updating":
      return "Updating the host…";
    case "restarting":
      return "Restarting the host…";
    case "stopped":
      return "Host stopped";
    case "other-host":
      return "Another host answered · restart nyte";
    case "signed-out":
      return "Sign in again";
    case "update-host":
      return "The host runs an older Nyte · update Nyte there";
    case "update-nyte":
      return "The host runs a newer Nyte · update this nyte";
    case "restart-host":
      return "The host runs an older Nyte · restart nyte host";
    default: {
      const _exhaustive: never = host;

      return _exhaustive;
    }
  }
}
