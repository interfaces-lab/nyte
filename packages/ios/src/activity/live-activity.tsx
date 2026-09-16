import { Voltra } from "@use-voltra/ios";
import { useLiveActivity } from "@use-voltra/ios-client";
import { useEffect } from "react";
import type { SessionInfo } from "@nyte-ai/protocol";

// WidgetKit renders this content in its own process, over a background that
// follows the device appearance, and it keeps rendering while the app is
// suspended. A fixed palette therefore suits one appearance and washes out in
// the other, so the activity names SwiftUI's adaptive colors instead of the
// app's brand hexes: they resolve per appearance at draw time, and the Dynamic
// Island, which is always dark, resolves them as light-on-black.
const FOREGROUND = "primary";
const MUTED = "secondary";
const ACCENT = "blue";
const WARNING = "orange";

function titleOf(session: SessionInfo): string {
  return session.name || "Untitled conversation";
}

function lockScreenUi(working: readonly SessionInfo[], attention: readonly SessionInfo[]) {
  const asking = attention.length > 0;
  const shown = [...attention, ...working].slice(0, 3);
  const extra = attention.length + working.length - shown.length;
  return (
    <Voltra.VStack style={{ padding: 16, gap: 10 }}>
      <Voltra.HStack style={{ gap: 6, alignItems: "center" }}>
        <Voltra.Symbol
          name={asking ? "questionmark.circle.fill" : "circle.grid.cross"}
          tintColor={asking ? WARNING : ACCENT}
          size={15}
        />
        <Voltra.Text style={{ color: FOREGROUND, fontSize: 17, fontWeight: "600" }}>
          {asking ? `${String(attention.length)} needs you` : `${String(working.length)} working`}
        </Voltra.Text>
      </Voltra.HStack>
      {shown.map((session) => {
        const waiting = attention.includes(session);
        return (
          <Voltra.HStack key={session.sessionId} style={{ gap: 8, alignItems: "center" }}>
            <Voltra.Text style={{ color: FOREGROUND, fontSize: 15, flex: 1 }} numberOfLines={1}>
              {titleOf(session)}
            </Voltra.Text>
            {waiting ? (
              <Voltra.Text style={{ color: WARNING, fontSize: 13 }}>Needs input</Voltra.Text>
            ) : session.heads[0]?.run !== undefined ? (
              <Voltra.Timer
                startAtMs={session.heads[0].run.startedAt}
                direction="up"
                textStyle="timer"
                style={{ color: MUTED, fontSize: 13 }}
              />
            ) : null}
          </Voltra.HStack>
        );
      })}
      {extra > 0 ? (
        <Voltra.Text style={{ color: MUTED, fontSize: 13 }}>{`${String(extra)} More`}</Voltra.Text>
      ) : null}
    </Voltra.VStack>
  );
}

/**
 * Mirrors the host's live work to the Lock Screen and Dynamic Island. It starts
 * when work appears, stays up while a conversation waits on the user, and ends
 * only when nothing is working and nothing is waiting. Tapping it opens the
 * conversation that needs an answer, or the list.
 */
export function useWorkLiveActivitySync(
  working: readonly SessionInfo[],
  attention: readonly SessionInfo[],
) {
  // One decision: a question outranks progress everywhere the activity shows.
  const asking = attention.length > 0;
  const lead = attention[0] ?? working[0];
  const count = asking ? attention.length : working.length;
  const symbol = asking ? "questionmark.circle.fill" : "circle.grid.cross";
  const tint = asking ? WARNING : ACCENT;
  const variants = {
    lockScreen: lockScreenUi(working, attention),
    island: {
      minimal: (
        <Voltra.Text style={{ color: asking ? WARNING : FOREGROUND }}>{String(count)}</Voltra.Text>
      ),
      compact: {
        leading: <Voltra.Symbol name={symbol} tintColor={tint} size={14} />,
        trailing: <Voltra.Text style={{ color: FOREGROUND }}>{String(count)}</Voltra.Text>,
      },
      expanded: {
        leading: <Voltra.Symbol name={symbol} tintColor={tint} size={16} />,
        trailing: <Voltra.Text style={{ color: FOREGROUND }}>{String(count)}</Voltra.Text>,
        center: (
          <Voltra.Text style={{ color: FOREGROUND }} numberOfLines={1}>
            {lead === undefined ? "Nyte" : titleOf(lead)}
          </Voltra.Text>
        ),
        bottom: (
          <Voltra.Text style={{ color: asking ? WARNING : MUTED }}>
            {asking
              ? "Waiting for your answer"
              : working.length === 0
                ? "No active work"
                : `${String(working.length)} working`}
          </Voltra.Text>
        ),
      },
    },
  };

  const activity = useLiveActivity(variants, {
    activityName: "nyte-work",
    deepLinkUrl: lead === undefined ? "nyte://" : `nyte://chat/${lead.sessionId}`,
  });
  const { start, update, end, isActive: liveActive } = activity;
  const live = working.length + attention.length;
  const activeKey = [...attention, ...working].map((session) => session.sessionId).join(",");

  useEffect(() => {
    if (live === 0) {
      if (liveActive) void end().catch(() => undefined);
      return;
    }
    if (liveActive) void update().catch(() => undefined);
    else void start().catch(() => undefined);
  }, [live, activeKey, liveActive, start, update, end]);

  return activity;
}
