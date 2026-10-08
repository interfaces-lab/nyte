import { useState } from "react";
import { ScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import type { Account } from "../account/account-provider.tsx";
import { ConnectPanel } from "../account/connect-panel.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { controls, spacing, textStyles, tokens } from "../theme.ts";
import { introCopy, recoveryCopy } from "./connect-copy.ts";
import type { SavedConnection } from "./connection.ts";
import type { HostRecovery } from "./host-context.tsx";
import { NyteMark } from "./nyte-mark.tsx";

export function ConnectWelcome({
  account,
  edit,
  notice,
  recovery,
  onManual,
  onPreview,
}: {
  account: Account | undefined;
  edit: { saved: SavedConnection; onCancel: () => void } | undefined;
  notice: string | undefined;
  recovery: HostRecovery | undefined;
  onManual: (method: "tailscale" | "direct") => void;
  onPreview: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const markSize = height < 700 ? 112 : 160;

  const intro =
    recovery === undefined
      ? introCopy({ editing: edit?.saved.kind, account: account !== undefined })
      : recoveryCopy(recovery.failure, recovery.saved);

  const replacing = edit?.saved ?? recovery?.saved;
  const [leaving, setLeaving] = useState(false);

  return (
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={scrollContent}>
      <html.div style={[styles.page, styles.safeArea(insets.top, insets.bottom)]}>
        {edit === undefined ? null : (
          <html.div style={styles.navigation}>
            <GlassButton label="Cancel" systemImage="chevron.left" onPress={edit.onCancel} />
          </html.div>
        )}
        <html.div style={styles.intro}>
          <html.div aria-hidden style={styles.mark(markSize)}>
            <NyteMark size={markSize} />
          </html.div>
          <html.div style={styles.headingGroup}>
            <html.h1 style={[textStyles.heading, styles.heading]}>
              {replacing === undefined ? "Welcome to Nyte" : intro.title}
            </html.h1>
            <html.p style={[textStyles.secondary, styles.description]}>
              {replacing === undefined ? "Connect to your computer." : intro.body}
            </html.p>
          </html.div>
        </html.div>
        <html.div style={styles.actions}>
          {notice === undefined ? null : (
            <html.p role="alert" style={[textStyles.secondary, styles.notice]}>
              {notice}
            </html.p>
          )}
          {recovery === undefined ? null : (
            <html.div style={styles.connectionOptions}>
              <GlassButton label="Try Again" prominent fill onPress={recovery.retry} />
              {recovery.repair === undefined ? null : (
                <GlassButton label="Pair as New Host" fill onPress={recovery.repair} />
              )}
            </html.div>
          )}
          {account === undefined ? (
            <html.div style={styles.inset}>
              <GlassButton
                label="Sign in to Nyte"
                prominent
                fill
                disabled
                onPress={() => undefined}
              />
              <html.p style={[textStyles.caption, styles.unavailable]}>
                Account sign-in is unavailable in this build.
              </html.p>
            </html.div>
          ) : (
            <ConnectPanel
              account={account}
              current={replacing === undefined ? undefined : { saved: replacing, reconnect: true }}
              welcome
            />
          )}
          <html.div style={styles.connectionOptions}>
            <GlassButton
              label="Connect with Tailscale"
              fill
              onPress={() => onManual("tailscale")}
            />
            <html.button onClick={() => onManual("direct")} style={styles.textButton}>
              <html.span style={[textStyles.secondary, styles.actionLabel]}>
                Use a local address or QR code
              </html.span>
            </html.button>
          </html.div>
          {recovery !== undefined ? (
            <html.button
              disabled={leaving}
              onClick={() => {
                setLeaving(true);
                void recovery.disconnect().finally(() => setLeaving(false));
              }}
              style={[styles.textButton, styles.preview]}
            >
              <html.span style={[textStyles.secondary, styles.danger]}>Disconnect</html.span>
            </html.button>
          ) : edit === undefined ? (
            <html.button onClick={onPreview} style={[styles.textButton, styles.preview]}>
              <html.span style={textStyles.caption}>Try a demo</html.span>
            </html.button>
          ) : null}
        </html.div>
      </html.div>
    </ScrollView>
  );
}

const scrollContent = { flexGrow: 1 } as const;

const styles = css.create({
  page: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    backgroundColor: tokens.background,
  },
  safeArea: (top: number, bottom: number) => ({
    paddingTop: top + spacing.lg,
    paddingBottom: bottom + spacing.sm,
  }),
  navigation: { display: "flex", alignItems: "flex-start", paddingInline: spacing.gutter },
  intro: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    paddingInline: spacing.xl,
    paddingBlock: spacing.xxl,
  },
  mark: (size: number) => ({ width: size, height: size }),
  headingGroup: { display: "flex", flexDirection: "column", alignItems: "center", gap: spacing.sm },
  heading: { margin: 0, textAlign: "center", textWrap: "balance" },
  description: { margin: 0, maxWidth: 280, textAlign: "center", textWrap: "balance" },
  actions: { display: "flex", flexDirection: "column", gap: spacing.md },
  inset: { paddingInline: spacing.gutter },
  unavailable: { margin: 0, paddingTop: spacing.sm, textAlign: "center" },
  notice: {
    margin: 0,
    paddingInline: spacing.gutter,
    paddingBottom: spacing.md,
    textAlign: "center",
  },
  connectionOptions: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingInline: spacing.gutter,
  },
  textButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: controls.touchTarget,
    paddingInline: spacing.sm,
    paddingBlock: spacing.xs,
    borderWidth: 0,
    backgroundColor: "transparent",
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
  actionLabel: { color: tokens.foreground, textAlign: "center" },
  danger: { color: tokens.danger, textAlign: "center" },
  preview: { alignSelf: "center" },
});
