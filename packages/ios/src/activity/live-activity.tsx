import { Voltra } from "@use-voltra/ios";
import { useLiveActivity } from "@use-voltra/ios-client";
import { useEffect } from "react";
import type { SessionInfo } from "@nyte-ai/protocol";

const FOREGROUND = "#f2f2f7";
const MUTED = "#8e8e93";
const ACCENT = "#0a84ff";

function lockScreenUi(active: readonly SessionInfo[]) {
  const shown = active.slice(0, 3);
  const extra = active.length - shown.length;
  return (
    <Voltra.VStack style={{ padding: 16, gap: 10 }}>
      <Voltra.HStack style={{ gap: 6, alignItems: "baseline" }}>
        <Voltra.Text style={{ color: FOREGROUND, fontSize: 22, fontWeight: "600" }}>
          {String(active.length)}
        </Voltra.Text>
        <Voltra.Text style={{ color: MUTED, fontSize: 15 }}>Active</Voltra.Text>
      </Voltra.HStack>
      {shown.map((session) => (
        <Voltra.HStack key={session.sessionId} style={{ gap: 8, alignItems: "center" }}>
          <Voltra.Text style={{ color: FOREGROUND, fontSize: 15, flex: 1 }} numberOfLines={1}>
            {session.name || "Untitled conversation"}
          </Voltra.Text>
          {session.heads[0]?.run !== undefined ? (
            <Voltra.Timer
              startAtMs={session.heads[0].run.startedAt}
              direction="up"
              textStyle="timer"
              style={{ color: MUTED, fontSize: 13 }}
            />
          ) : null}
        </Voltra.HStack>
      ))}
      {extra > 0 ? (
        <Voltra.Text style={{ color: MUTED, fontSize: 13 }}>{`${String(extra)} More`}</Voltra.Text>
      ) : null}
    </Voltra.VStack>
  );
}

/**
 * Mirrors the host's working sessions to the Lock Screen and Dynamic Island.
 * It starts when work appears, updates while the set of sessions changes, and
 * ends when nothing is working.
 */
export function useWorkLiveActivitySync(active: readonly SessionInfo[]) {
  const variants = {
    lockScreen: lockScreenUi(active),
    island: {
      minimal: <Voltra.Text style={{ color: FOREGROUND }}>{String(active.length)}</Voltra.Text>,
      compact: {
        leading: <Voltra.Symbol name="circle.grid.cross" tintColor={ACCENT} size={14} />,
        trailing: <Voltra.Text style={{ color: FOREGROUND }}>{String(active.length)}</Voltra.Text>,
      },
      expanded: {
        leading: <Voltra.Symbol name="circle.grid.cross" tintColor={ACCENT} size={16} />,
        trailing: <Voltra.Text style={{ color: FOREGROUND }}>{String(active.length)}</Voltra.Text>,
        center: (
          <Voltra.Text style={{ color: FOREGROUND }} numberOfLines={1}>
            {active[0]?.name ?? "Nyte"}
          </Voltra.Text>
        ),
        bottom: (
          <Voltra.Text style={{ color: MUTED }}>
            {active.length === 0 ? "No active work" : `${String(active.length)} working`}
          </Voltra.Text>
        ),
      },
    },
  };

  const activity = useLiveActivity(variants, {
    activityName: "nyte-work",
    deepLinkUrl: "nyte://",
  });
  const { start, update, end, isActive: liveActive } = activity;
  const count = active.length;
  const activeKey = active.map((session) => session.sessionId).join(",");

  useEffect(() => {
    if (count === 0) {
      if (liveActive) void end().catch(() => undefined);
      return;
    }
    if (liveActive) void update().catch(() => undefined);
    else void start().catch(() => undefined);
  }, [count, activeKey, liveActive, start, update, end]);

  return activity;
}
