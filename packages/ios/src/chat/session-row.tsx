import type { SessionInfo } from "@nyte-ai/protocol";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { controls, list, useTheme, radii, textStyles, tokens, typography } from "../theme.ts";
import { elapsed, formatActivity, latestRun, markOf, statusLabels } from "./sessions.ts";

function Meta({ session, now }: { session: SessionInfo; now: number }) {
  const theme = useTheme();
  const mark = markOf(session);
  const run = latestRun(session);
  const time = formatActivity(session.lastActivityAt, now);
  const running = mark === "working" || mark === "retry";

  if (running) {
    const since = run !== undefined ? ` · ${elapsed(run.startedAt, now)}` : "";
    return (
      <html.span style={[textStyles.secondary, styles.meta]}>
        {`${statusLabels[mark]}${since}`}
      </html.span>
    );
  }
  if (mark === "waiting") {
    return (
      <html.span style={[textStyles.secondary, styles.meta, styles.needsInput]}>
        {`${statusLabels.waiting} · ${time}`}
      </html.span>
    );
  }
  if (mark === "failed") {
    return (
      <html.span style={styles.metaRow}>
        <SymbolView name="xmark" size={controls.iconXs} tintColor={theme.danger} />
        <html.span style={[textStyles.secondary, styles.meta, styles.failed]}>
          {`Failed · ${time}`}
        </html.span>
      </html.span>
    );
  }
  if (run !== undefined) {
    return (
      <html.span style={styles.metaRow}>
        <SymbolView
          name="checkmark"
          size={controls.iconXs}
          tintColor={theme.success}
          weight="semibold"
        />
        <html.span style={[textStyles.secondary, styles.meta]}>{`Finished · ${time}`}</html.span>
      </html.span>
    );
  }
  return (
    <html.span style={[textStyles.secondary, styles.meta]}>
      {session.preview === undefined || session.preview === ""
        ? `New · ${time}`
        : `${session.preview} · ${time}`}
    </html.span>
  );
}

export function SessionRow({
  session,
  now,
  last = false,
  onPress,
}: {
  session: SessionInfo;
  now: number;
  last?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const mark = markOf(session);
  return (
    <html.button
      aria-label={`${session.name || "Untitled conversation"}, ${statusLabels[mark]}`}
      onClick={onPress}
      style={styles.row}
    >
      <html.div style={styles.leading}>
        {mark === "working" || mark === "retry" ? (
          <SymbolView
            name="circle.grid.cross"
            size={controls.iconXs}
            tintColor={mark === "retry" ? theme.warning : theme.accent}
            animationSpec={{ effect: { type: "pulse" }, repeating: true }}
          />
        ) : (
          <html.div
            style={[
              styles.dot,
              mark === "waiting" && styles.dotWaiting,
              mark === "failed" && styles.dotFailed,
              mark === "idle" && styles.dotIdle,
            ]}
          />
        )}
      </html.div>
      <html.div style={[styles.text, !last && styles.separator]}>
        <html.span style={[textStyles.body, styles.title]}>
          {session.name || "Untitled conversation"}
        </html.span>
        <Meta session={session} now={now} />
      </html.div>
    </html.button>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
    paddingInlineStart: list.gutter,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  leading: {
    width: list.leading,
    height: `${typography.body.lineHeight}px`,
    marginTop: list.rowPaddingBlock,
    marginRight: list.leadingGap,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dot: {
    width: controls.statusDot,
    height: controls.statusDot,
    borderRadius: radii.pill,
  },
  dotWaiting: { backgroundColor: tokens.accent },
  dotFailed: { backgroundColor: tokens.danger },
  dotIdle: { backgroundColor: tokens.tertiary },
  text: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: list.titleMetaGap,
    paddingBlock: list.rowPaddingBlock,
    paddingRight: list.gutter,
  },
  separator: {
    borderBottomWidth: controls.hairline,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.separator,
  },
  title: { textAlign: "start", lineClamp: 1 },
  meta: { textAlign: "start", lineClamp: 1, fontVariant: "tabular-nums" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  needsInput: { color: tokens.foreground },
  failed: { color: tokens.danger },
});
