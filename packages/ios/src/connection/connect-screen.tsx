import { useRef, useState } from "react";
import { useMountEffect } from "../use-mount-effect.ts";
import type { ReactNode } from "react";
import { ActivityIndicator, TextInput } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { ScanSheet } from "./scan-sheet.tsx";
import { displayAddress, parseConnection, type Connection } from "./connection.ts";
import {
  connectCopy,
  introCopy,
  SHARE_LOCATION,
  type ConnectFailure,
  type ConnectStage,
} from "./connect-copy.ts";
import {
  controls,
  useTheme,
  radii,
  spacing,
  textStyles,
  tokens,
  typography,
  type Theme,
} from "../theme.ts";

/** A wrong address on the local network can hang for minutes; the form gives up first. */
const VERIFY_TIMEOUT_MS = 10_000;

export function ConnectScreen({
  onConnect,
  edit,
  notice,
}: {
  onConnect: (connection: Connection, signal: AbortSignal) => Promise<ConnectFailure | undefined>;
  /** Present when the form replaces a live connection rather than creating one. */
  edit: { connection: Connection; onCancel: () => void } | undefined;
  notice: string | undefined;
}) {
  const theme = useTheme();
  const [name, setName] = useState(edit?.connection.name ?? "My Mac");
  const [url, setUrl] = useState(edit?.connection.url ?? "");
  const [token, setToken] = useState(edit?.connection.token ?? "");
  const [scanning, setScanning] = useState(false);
  const device = useCameraDevice("back");
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  // No camera means no scan path, so the form is the only way in.
  const canScan = device !== undefined;
  const [revealToken, setRevealToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ConnectStage>({ kind: "idle" });
  const attempt = useRef<AbortController>(undefined);
  const nameInput = useRef<TextInput>(null);
  const addressInput = useRef<TextInput>(null);
  const tokenInput = useRef<TextInput>(null);
  const complete = name.trim().length > 0 && url.trim().length > 0 && token.trim().length > 0;
  useMountEffect(() => () => {
    attempt.current?.abort();
    attempt.current = undefined;
  });

  async function connect(scanned?: Connection) {
    if (attempt.current !== undefined) return;
    setStage({ kind: "idle" });
    let target: Connection;
    try {
      target = scanned ?? parseConnection({ name, url, token });
    } catch (cause) {
      setStage({
        kind: "rejected",
        reason: cause instanceof Error ? cause.message : "Check the connection details.",
      });
      return;
    }
    const address = displayAddress(target);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, VERIFY_TIMEOUT_MS);
    attempt.current = controller;
    setBusy(true);
    setStage({ kind: "verifying", address });
    try {
      const failure = await onConnect(target, controller.signal);
      if (attempt.current !== controller) return;
      // Only the form knows its own deadline, so it renames its own timeout.
      if (failure !== undefined)
        setStage(failure.kind === "cancelled" && timedOut ? { kind: "silent", address } : failure);
    } catch (cause) {
      // Connecting reports endings as values, so a throw here is a bug in this app.
      if (attempt.current === controller)
        setStage({
          kind: "unexpected",
          detail: cause instanceof Error ? cause.message : String(cause),
        });
    } finally {
      clearTimeout(timer);
      if (attempt.current === controller) {
        attempt.current = undefined;
        setBusy(false);
      }
    }
  }

  /** The permission prompt belongs to the tap that opens the camera. */
  async function openScanner() {
    setStage({ kind: "idle" });
    if (!hasPermission && canRequestPermission) {
      try {
        await requestPermission();
      } catch {
        setStage({ kind: "rejected", reason: "Couldn't request camera access." });
        return;
      }
    }
    setScanning(true);
  }

  const intro = introCopy(edit !== undefined);
  const failure = stage.kind === "idle" || stage.kind === "verifying" ? undefined : stage;
  const alert = failure === undefined ? undefined : connectCopy(failure);
  return (
    <>
      <ScanSheet
        visible={scanning}
        onClose={() => setScanning(false)}
        onScan={(scanned) => {
          setScanning(false);
          setName(scanned.name);
          setUrl(scanned.url);
          setToken(scanned.token);
          void connect(scanned);
        }}
      />
      <KeyboardAwareScrollView
        bottomOffset={spacing.lg}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <html.div style={styles.page}>
          {edit === undefined ? null : (
            <html.div style={styles.navBar}>
              <GlassButton
                label="Cancel"
                systemImage="chevron.left"
                iconOnly
                disabled={busy}
                onPress={edit.onCancel}
              />
            </html.div>
          )}
          <html.div style={styles.intro}>
            <html.h1 style={[textStyles.heading, styles.text]}>{intro.title}</html.h1>
            <html.p style={[textStyles.body, styles.lead]}>{intro.body}</html.p>
          </html.div>
          {canScan && !busy ? (
            <html.div style={styles.actions}>
              <GlassButton
                label="Scan QR code"
                systemImage="qrcode.viewfinder"
                fill
                onPress={() => void openScanner()}
              />
              <html.p style={[textStyles.caption, styles.footnote]}>
                The code is in Nyte › {SHARE_LOCATION} on your Mac.
              </html.p>
            </html.div>
          ) : null}
          <html.div style={styles.form}>
            <Field label="Name">
              <TextInput
                ref={nameInput}
                accessibilityLabel="Name"
                value={name}
                onChangeText={setName}
                editable={!busy}
                style={inputStyle(theme)}
                placeholder="My Mac"
                placeholderTextColor={theme.muted}
                autoComplete="off"
                textContentType="none"
                onSubmitEditing={() => addressInput.current?.focus()}
                submitBehavior="submit"
                returnKeyType="next"
              />
            </Field>
            <html.div style={styles.separator} />
            <Field label="Address">
              <TextInput
                ref={addressInput}
                accessibilityLabel="Address"
                value={url}
                onChangeText={setUrl}
                editable={!busy}
                style={inputStyle(theme)}
                placeholder="http://100.x.y.z:port"
                placeholderTextColor={theme.muted}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="URL"
                onSubmitEditing={() => tokenInput.current?.focus()}
                submitBehavior="submit"
                returnKeyType="next"
              />
            </Field>
            <html.div style={styles.separator} />
            <Field
              label="Token"
              trailing={
                <html.button
                  aria-label={revealToken ? "Hide token" : "Show token"}
                  onClick={() => setRevealToken(!revealToken)}
                  style={styles.revealButton}
                >
                  <SymbolView
                    name={revealToken ? "eye.slash" : "eye"}
                    size={controls.icon}
                    tintColor={theme.muted}
                  />
                </html.button>
              }
            >
              <TextInput
                ref={tokenInput}
                accessibilityLabel="Token"
                value={token}
                onChangeText={setToken}
                editable={!busy}
                style={inputStyle(theme)}
                placeholder="Paste from your Mac"
                placeholderTextColor={theme.muted}
                secureTextEntry={!revealToken}
                keyboardType="ascii-capable"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                // Go stays enabled with a token, so send the user to whichever field is still empty.
                onSubmitEditing={() => {
                  if (complete) void connect();
                  else
                    (name.trim() === ""
                      ? nameInput
                      : url.trim() === ""
                        ? addressInput
                        : tokenInput
                    ).current?.focus();
                }}
                enablesReturnKeyAutomatically
                returnKeyType="go"
              />
            </Field>
          </html.div>
          {alert === undefined ? (
            notice === undefined ? null : (
              <html.div role="status" style={styles.alert}>
                <SymbolView name="info.circle.fill" size={controls.icon} tintColor={theme.muted} />
                <html.p style={[textStyles.body, styles.alertText]}>{notice}</html.p>
              </html.div>
            )
          ) : (
            <html.div role="alert" style={styles.alert}>
              <SymbolView
                name="exclamationmark.circle.fill"
                size={controls.icon}
                tintColor={theme.danger}
              />
              {/* Title names the cause; body is the instruction that follows from it. */}
              <html.div style={styles.alertText}>
                <html.p style={textStyles.error}>{alert.title}</html.p>
                <html.p style={[textStyles.caption, styles.alertBody]}>{alert.body}</html.p>
              </html.div>
            </html.div>
          )}
          {busy ? (
            <html.div style={styles.actions}>
              <html.div style={styles.progress} aria-live="polite">
                <ActivityIndicator color={theme.foreground} />
                <html.span style={textStyles.title}>{connectCopy(stage).title}</html.span>
              </html.div>
              <GlassButton label="Cancel" fill onPress={() => attempt.current?.abort()} />
            </html.div>
          ) : (
            <html.div style={styles.actions}>
              {/* Always actionable: an empty field is explained by the alert above,
                not by a dead grey button. */}
              <GlassButton
                label={alert?.retry ?? (edit === undefined ? "Connect" : "Save connection")}
                prominent
                fill
                onPress={() => void connect()}
              />
            </html.div>
          )}
          <html.p style={[textStyles.caption, styles.footnote]}>
            A loopback address reaches only a simulator on your Mac. The token stays in Keychain.
          </html.p>
        </html.div>
      </KeyboardAwareScrollView>
    </>
  );
}

function Field({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <html.div style={styles.field}>
      <html.span style={[textStyles.label, styles.label]}>{label}</html.span>
      <html.div style={styles.control}>
        {children}
        {trailing}
      </html.div>
    </html.div>
  );
}

function inputStyle(theme: Theme) {
  return {
    // No line height: an iOS single-line field lays its own text out, and a
    // fixed one wraps a long token instead of scrolling it.
    fontSize: typography.title.fontSize,
    fontWeight: typography.body.fontWeight,
    flex: 1,
    minWidth: 0,
    color: theme.foreground,
    paddingVertical: 0,
    height: controls.touchTarget,
  };
}

const styles = css.create({
  page: {
    display: "flex",
    flexDirection: "column",
    paddingInline: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  text: { margin: 0 },
  footnote: { margin: 0, textAlign: "center", paddingInline: spacing.sm },
  // Editing replaces a live connection, so the form needs a way back. First run
  // has nowhere to return to and shows no button.
  navBar: { display: "flex", flexDirection: "row", alignItems: "center" },
  intro: { display: "flex", flexDirection: "column", gap: spacing.sm, paddingTop: spacing.sm },
  lead: { color: tokens.muted, margin: 0 },
  form: {
    // The same card the grouped rows elsewhere draw: one surface, no border or
    // shadow stating the same edge again.
    backgroundColor: tokens.surface,
    borderRadius: radii.card,
    overflow: "hidden",
    paddingInline: spacing.lg,
  },
  field: { paddingBlock: spacing.xs },
  // Inset to the labels, the way a grouped list draws its hairlines.
  separator: {
    height: controls.hairline,
    backgroundColor: tokens.separator,
  },
  label: { color: tokens.muted, paddingTop: spacing.xs },
  control: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    // A token is one long word: the row keeps its height and the field scrolls,
    // rather than wrapping a second line out through the card's bottom edge.
    height: controls.touchTarget,
    overflow: "hidden",
  },
  revealButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: controls.touchTarget,
    height: controls.touchTarget,
    // The hit region overhangs into the card padding so the icon ends on the field's edge.
    marginInlineEnd: (controls.icon - controls.touchTarget) / 2,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    opacity: { default: 1, ":active": controls.disabledOpacity },
  },
  alert: { display: "flex", flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  alertText: {
    margin: 0,
    flexShrink: 1,
  },
  alertBody: { margin: 0, paddingTop: spacing.xs },
  actions: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: spacing.sm },
  progress: {
    minHeight: controls.primaryHeight,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
