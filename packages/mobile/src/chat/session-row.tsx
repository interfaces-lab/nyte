import type { SessionInfo } from "@nyte-ai/protocol";
import { sessionMark } from "@nyte-ai/client";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator } from "react-native";
import { css, html } from "react-strict-dom";
import { controls, list, useTheme, radii, textStyles, tokens, typography } from "../theme.ts";
import { elapsed, formatActivity, latestRun, rowStatus } from "./sessions.ts";

/**
 * One line under the title: the status word plus its clock. A conversation with
 * no run yet shows its preview instead, because "New" says less than the text
 * the user typed.
 */
function Meta({
  session,
  now,
  twoLines,
}: {
  session: SessionInfo;
  now: number;
  twoLines: boolean;
}) {
  const mark = sessionMark(session);
  const run = latestRun(session);
  const clock =
    mark === "working" || mark === "retry"
      ? run === undefined
        ? undefined
        : elapsed(run.startedAt, now)
      : formatActivity(session.lastActivityAt, now);
  const lead =
    mark === "idle" && run === undefined && session.preview !== undefined && session.preview !== ""
      ? session.preview
      : rowStatus(session);
  return (
    <html.span
      style={[
        textStyles.secondary,
        twoLines ? styles.metaTwoLines : styles.meta,
        mark === "waiting" && styles.needsInput,
        mark === "failed" && styles.failed,
      ]}
    >
      {clock === undefined ? lead : `${lead} \u00b7 ${clock}`}
    </html.span>
  );
}

/** The row's single status glyph, in the column every row shares. */
function Status({ session }: { session: SessionInfo }) {
  const theme = useTheme();
  const mark = sessionMark(session);
  if (mark === "working" || mark === "retry") {
    return (
      <ActivityIndicator
        size="small"
        color={mark === "retry" ? theme.warning : theme.accent}
        style={{ transform: [{ scale: list.spinnerScale }] }}
      />
    );
  }
  if (mark === "failed") {
    return <SymbolView name="xmark" size={controls.iconXs} tintColor={theme.danger} />;
  }
  if (mark === "idle" && latestRun(session) !== undefined) {
    return (
      <SymbolView
        name="checkmark"
        size={controls.iconXs}
        tintColor={theme.success}
        weight="semibold"
      />
    );
  }
  return <html.div style={[styles.dot, mark === "waiting" ? styles.dotWaiting : styles.dotIdle]} />;
}

export function SessionRow({
  session,
  now,
  last = false,
  twoLines = false,
  onPress,
}: {
  session: SessionInfo;
  now: number;
  last?: boolean;
  /** Lets the status-and-preview line wrap onto a second line. */
  twoLines?: boolean;
  onPress: () => void;
}) {
  return (
    <html.button
      aria-label={`${session.name || "Untitled conversation"}, ${rowStatus(session)}`}
      onClick={onPress}
      style={styles.row}
    >
      <html.div style={styles.leading}>
        <Status session={session} />
      </html.div>
      <html.div style={[styles.text, !last && styles.separator]}>
        <html.span style={[textStyles.body, styles.title]}>
          {session.name || "Untitled conversation"}
        </html.span>
        <Meta session={session} now={now} twoLines={twoLines} />
      </html.div>
    </html.button>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    // Content-box sizing: a width of 100% plus the gutter would overflow the list.
    paddingInlineStart: list.gutter,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  leading: {
    display: "flex",
    flexDirection: "column",
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
  dotIdle: { backgroundColor: tokens.tertiary },
  text: {
    display: "flex",
    flexDirection: "column",
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
  metaTwoLines: { textAlign: "start", lineClamp: 2, fontVariant: "tabular-nums" },
  needsInput: { color: tokens.foreground },
  failed: { color: tokens.danger },
});
