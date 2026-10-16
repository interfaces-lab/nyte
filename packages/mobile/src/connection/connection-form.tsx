import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Keyboard, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { ScanSheet } from "./scan-sheet.tsx";
import { displayAddress, parseConnection, type Connection } from "./connection.ts";
import { connectCopy, SHARE_LOCATION, type ConnectStage } from "./connect-copy.ts";
import { connectHost } from "./host.ts";
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

const VERIFY_TIMEOUT_MS = 10_000;

export type ConnectionMethod = "tailscale" | "direct";

export type ConnectionFormMode =
  | {
      readonly kind: "connect";
      readonly method: ConnectionMethod;
      readonly initial: Connection | undefined;
    }
  | { readonly kind: "edit"; readonly connection: Connection };

export function ConnectionForm({
  mode,
  onCancel,
  onSaved,
}: {
  mode: ConnectionFormMode;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const initial = mode.kind === "edit" ? mode.connection : mode.initial;
  const method = mode.kind === "connect" ? mode.method : "direct";
  const [name, setName] = useState(initial?.name ?? "My Mac");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
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

  async function connect(scanned?: Connection, repairing = false) {
    if (attempt.current !== undefined) return;
    const changed = stage.kind === "identityChanged" ? stage.url : undefined;
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

    if (
      mode.kind === "edit" &&
      target.name === mode.connection.name &&
      target.url === mode.connection.url &&
      target.token === mode.connection.token
    ) {
      Keyboard.dismiss();
      onSaved();
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
      const result = await connectHost({
        connection: target,
        signal: controller.signal,
        repair: repairing && changed === target.url,
      });

      if (result.kind === "connected") {
        Keyboard.dismiss();
        onSaved();
        return;
      }
      const failure = result;

      if (attempt.current !== controller) return;

      // Only the form knows its own deadline, so it renames its own timeout.
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
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <View
          style={{
            padding: spacing.gutter,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <Text
            accessibilityRole="header"
            dynamicTypeRamp="title2"
            style={{ flex: 1, fontSize: 22, fontWeight: "700", color: theme.foreground }}
          >
            {mode.kind === "edit"
              ? "Edit connection"
              : method === "tailscale"
                ? "Connect with Tailscale"
                : "Connect a computer"}
          </Text>
          <GlassButton
            label="Cancel"
            onPress={() => {
              attempt.current?.abort();
              Keyboard.dismiss();
              setRevealToken(false);
              onCancel();
            }}
          />
        </View>
        <KeyboardAwareScrollView
          bottomOffset={spacing.lg}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingBottom: insets.bottom }}
        >
          <html.div style={styles.page}>
            {mode.kind === "connect" ? (
              <html.p style={[textStyles.body, styles.lead]}>
                {method === "tailscale"
                  ? "Turn on Tailscale on your iPhone and the computer, then enter its Tailscale address and Nyte device token."
                  : `In the desktop app, copy these from ${SHARE_LOCATION}. For nyte serve, use the address and token it prints.`}
              </html.p>
            ) : null}
            {canScan && !busy ? (
              <html.div style={styles.actions}>
                <GlassButton
                  label="Scan QR code"
                  systemImage="qrcode.viewfinder"
                  fill
                  onPress={() => void openScanner()}
                />
                {mode.kind === "connect" ? (
                  <html.p style={[textStyles.caption, styles.footnote]}>
                    The code is in Nyte › {SHARE_LOCATION} on your Mac.
                  </html.p>
                ) : null}
              </html.div>
            ) : null}
            <html.div style={styles.form}>
              <Field label="Computer name">
                <TextInput
                  ref={nameInput}
                  accessibilityLabel="Computer name"
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
              <Field label={method === "tailscale" ? "Tailscale address" : "Server address"}>
                <TextInput
                  ref={addressInput}
                  accessibilityLabel="Address"
                  value={url}
                  onChangeText={setUrl}
                  editable={!busy}
                  style={inputStyle(theme)}
                  placeholder={
                    method === "tailscale" ? "http://100.x.y.z:port" : "http://127.0.0.1:port"
                  }
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
                label="Device token"
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
                  accessibilityLabel="Device token"
                  value={token}
                  onChangeText={setToken}
                  editable={!busy}
                  style={inputStyle(theme)}
                  placeholder="Paste the token"
                  placeholderTextColor={theme.muted}
                  secureTextEntry={!revealToken}
                  keyboardType="ascii-capable"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
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
            {alert === undefined ? null : (
              <html.div role="alert" style={styles.alert}>
                <SymbolView
                  name="exclamationmark.circle.fill"
                  size={controls.icon}
                  tintColor={theme.danger}
                />
                {}
                <html.div style={styles.alertText}>
                  <html.p style={textStyles.error}>{alert.title}</html.p>
                  <html.p style={[textStyles.caption, styles.alertBody]}>{alert.body}</html.p>
                </html.div>
              </html.div>
            )}
            <html.div style={styles.actions}>
              {busy ? (
                <html.div style={styles.progress} aria-live="polite">
                  <ActivityIndicator color={theme.foreground} />
                  <html.span style={textStyles.title}>{connectCopy(stage).title}</html.span>
                </html.div>
              ) : null}
              <GlassButton
                label={alert?.retry ?? (mode.kind === "connect" ? "Connect" : "Save changes")}
                busy={busy}
                disabled={!complete || busy}
                prominent
                fill
                onPress={() => void connect(undefined, stage.kind === "identityChanged")}
              />
              {busy ? (
                <GlassButton
                  label="Cancel Connection"
                  fill
                  onPress={() => attempt.current?.abort()}
                />
              ) : null}
            </html.div>
            <html.p style={[textStyles.caption, styles.footnote]}>
              {method === "tailscale"
                ? `Find these in Nyte › ${SHARE_LOCATION} on your Mac.`
                : "A 127.0.0.1 address works in the simulator on your Mac."}
            </html.p>
          </html.div>
        </KeyboardAwareScrollView>
      </View>
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
      <html.span style={[textStyles.secondary, styles.label]}>{label}</html.span>
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
    fontSize: typography.body.fontSize,
    fontWeight: typography.body.fontWeight,
    flex: 1,
    minWidth: 0,
    color: theme.foreground,
    paddingVertical: spacing.sm,
    minHeight: controls.touchTarget,
  };
}

const styles = css.create({
  page: {
    display: "flex",
    flexDirection: "column",
    paddingInline: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  footnote: { margin: 0, textAlign: "center", paddingInline: spacing.sm },
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
    minHeight: controls.touchTarget,
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
