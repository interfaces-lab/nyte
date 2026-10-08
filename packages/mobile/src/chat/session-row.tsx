import { Link } from "expo-router";
import type { SessionInfo } from "@nyte-ai/protocol";
import { sessionMark } from "@nyte-ai/client";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable } from "react-native";
import { css, html } from "react-strict-dom";
import { controls, list, useTheme, radii, textStyles, tokens, typography } from "../theme.ts";
import { elapsed, formatActivity, latestRun, rowStatus } from "./sessions.ts";

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
      : undefined;

  const lead =
    mark === "idle"
      ? session.preview?.trim() ||
        session.workspace.cwd.split("/").filter(Boolean).at(-1) ||
        "New chat"
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

  return <html.div style={[styles.dot, mark === "waiting" ? styles.dotWaiting : styles.dotIdle]} />;
}

export function SessionRow({
  session,
  now,
  last = false,
  twoLines = false,
}: {
  session: SessionInfo;
  now: number;
  last?: boolean;
  twoLines?: boolean;
}) {
  return (
    <Link href={`/chat/${session.sessionId}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${session.name || "New chat"}, ${rowStatus(session)}`}
      >
        <html.div style={styles.row}>
          <html.div style={styles.leading}>
            <Status session={session} />
          </html.div>
          <html.div style={[styles.text, !last && styles.separator]}>
            <html.div style={styles.titleRow}>
              <html.span style={[textStyles.body, styles.title]}>
                {session.name || "New chat"}
              </html.span>
              <html.span style={[textStyles.caption, styles.clock]}>
                {formatActivity(session.lastActivityAt, now)}
              </html.span>
            </html.div>
            <Meta session={session} now={now} twoLines={twoLines} />
          </html.div>
        </html.div>
      </Pressable>
    </Link>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingInlineStart: list.gutter,
    borderWidth: 0,
    textDecoration: "none",
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
  titleRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: list.leadingGap,
  },
  title: { textAlign: "start", lineClamp: 1, flexGrow: 1, flexShrink: 1 },
  clock: { flexShrink: 0, fontVariant: "tabular-nums" },
  meta: { textAlign: "start", lineClamp: 1, fontVariant: "tabular-nums" },
  metaTwoLines: { textAlign: "start", lineClamp: 2, fontVariant: "tabular-nums" },
  needsInput: { color: tokens.foreground },
  failed: { color: tokens.danger },
});
