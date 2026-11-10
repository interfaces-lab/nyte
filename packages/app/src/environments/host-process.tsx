import { useMutation } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { toast } from "@nyte-ai/ui/toast";
import { FactRow } from "../components/connection-list.tsx";
import type { HostProcess } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { nyte } from "../contract/nyte.ts";
import { useHostProcess } from "../data/host.ts";
import { useNowMinute } from "../lib/use-now-minute.ts";
import { SettingsSection } from "../settings/rows.tsx";

const MINUTE_MS = 60_000;

type HostAction = "restart" | "stop" | "start";

function uptime(startedAt: number, now: number): string {
  const minutes = Math.floor((now - startedAt) / MINUTE_MS);

  if (minutes < 1) return "Running for less than a minute";
  const hours = Math.floor(minutes / 60);

  if (hours < 1) return `Running for ${String(minutes)}m`;

  return hours < 24
    ? `Running for ${String(hours)}h ${String(minutes % 60)}m`
    : `Running for ${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

function hostDetail(state: HostProcess | undefined, now: number): string {
  switch (state?.kind) {
    case undefined:
      return "Checking…";
    case "restarting":
      return "Restarting…";
    case "offline":
      return "Not running";
    case "current":
    case "stale":
      return `Version ${state.version} · ${state.startedAt === null ? "Running" : uptime(state.startedAt, now)}`;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

export function HostProcessSection(): ReactElement | null {
  const bridge = nyte.host.hostProcess;
  const state = useHostProcess().data;
  const now = useNowMinute();

  const act = useMutation({
    mutationFn: async (action: HostAction) =>
      action === "start" ? bridge?.start() : bridge?.confirm({ action }),
    onError: (cause, action) =>
      toast.add({
        type: "error",
        title: `Couldn't ${action} Nyte Host: ${errorMessage(cause)}`,
        id: "host-process",
      }),
  });

  if (bridge === undefined) return null;

  const running = state?.kind === "current" || state?.kind === "stale";

  return (
    <SettingsSection>
      <FactRow icon="server" title="Nyte Host" detail={hostDetail(state, now)}>
        {state?.kind === "offline" && (
          <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate("start")}>
            Start Host
          </Button>
        )}
        {running && (
          <Button
            variant="outline"
            tone="danger"
            disabled={act.isPending}
            onClick={() => act.mutate("stop")}
          >
            Stop Host…
          </Button>
        )}
      </FactRow>
      {state?.kind === "stale" && (
        <FactRow
          title="Newer host available"
          detail={`This host runs Nyte ${state.version}. Restart it to run this app's build.`}
        >
          <Button
            variant="solid"
            tone="primary"
            disabled={act.isPending}
            onClick={() => act.mutate("restart")}
          >
            Restart Host…
          </Button>
        </FactRow>
      )}
    </SettingsSection>
  );
}
