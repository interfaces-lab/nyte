import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, TextInput } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { GlassButton } from "../ui/glass-button.tsx";
import { displayAddress, parseConnection, type Connection } from "./connection.ts";
import {
  controls,
  media,
  nativeTheme,
  radii,
  spacing,
  textStyles,
  tokens,
  typography,
} from "../theme.ts";

/** A wrong address on the local network can hang for minutes; the form gives up first. */
const VERIFY_TIMEOUT_MS = 10_000;

export function ConnectScreen({
  onConnect,
  notice,
}: {
  onConnect: (connection: Connection, signal: AbortSignal) => Promise<void>;
  notice: string | undefined;
}) {
  const [name, setName] = useState("My Mac");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [revealToken, setRevealToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<AbortController>(undefined);
  const nameInput = useRef<TextInput>(null);
  const addressInput = useRef<TextInput>(null);
  const tokenInput = useRef<TextInput>(null);
  const complete = name.trim().length > 0 && url.trim().length > 0 && token.trim().length > 0;
  useEffect(
    () => () => {
      attempt.current?.abort();
      attempt.current = undefined;
    },
    [],
  );

  async function connect() {
    if (attempt.current !== undefined || !complete) return;
    setError(undefined);
    let connection: Connection;
    try {
      connection = parseConnection({ name, url, token });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the connection details.");
      return;
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, VERIFY_TIMEOUT_MS);
    attempt.current = controller;
    setBusy(true);
    try {
      await onConnect(connection, controller.signal);
    } catch (cause) {
      if (attempt.current !== controller) return;
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Couldn't connect.");
      } else if (timedOut) {
        setError(
          `No reply from ${displayAddress(connection)}. Check the address and that sharing is on.`,
        );
      }
    } finally {
      clearTimeout(timer);
      if (attempt.current === controller) {
        attempt.current = undefined;
        setBusy(false);
      }
    }
  }

  const message = error ?? notice;
  return (
    <KeyboardAwareScrollView
      bottomOffset={spacing.lg}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <html.div style={styles.page}>
        <html.span style={[textStyles.secondary, styles.wordmark]}>nyte</html.span>
        <html.div style={styles.devices} aria-hidden>
          <html.div style={styles.deviceTile}>
            <SymbolView
              name="laptopcomputer"
              size={media.macSymbol}
              tintColor={nativeTheme.foreground}
            />
          </html.div>
          <html.div style={styles.linkDots}>
            <html.div style={styles.dot} />
            <html.div style={styles.dot} />
            <html.div style={styles.dot} />
          </html.div>
          <html.div style={styles.deviceTile}>
            <SymbolView name="iphone" size={media.phoneSymbol} tintColor={nativeTheme.foreground} />
          </html.div>
        </html.div>
        <html.div style={styles.intro}>
          <html.h1 style={[textStyles.heading, styles.text]}>Connect your Mac</html.h1>
          <html.p style={[textStyles.body, styles.lead]}>
            On your Mac, open Settings › Server and start sharing under iOS Simulator. Enter the
            address and token it shows.
          </html.p>
        </html.div>
        <html.div style={styles.form}>
          <Field label="Name">
            <TextInput
              ref={nameInput}
              accessibilityLabel="Name"
              value={name}
              onChangeText={setName}
              editable={!busy}
              style={inputStyle}
              placeholder="My Mac"
              placeholderTextColor={nativeTheme.muted}
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
              style={inputStyle}
              placeholder="http://127.0.0.1:port"
              placeholderTextColor={nativeTheme.muted}
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
                  tintColor={nativeTheme.muted}
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
              style={inputStyle}
              placeholder="Paste from your Mac"
              placeholderTextColor={nativeTheme.muted}
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
        {message !== undefined && (
          <html.div role="alert" style={styles.alert}>
            <SymbolView
              name="exclamationmark.circle.fill"
              size={controls.icon}
              tintColor={nativeTheme.danger}
            />
            <html.p style={[textStyles.error, styles.alertText]}>{message}</html.p>
          </html.div>
        )}
        {busy ? (
          <html.div style={styles.actions}>
            <html.div style={styles.progress} aria-live="polite">
              <ActivityIndicator color={nativeTheme.foreground} />
              <html.span style={textStyles.title}>Connecting…</html.span>
            </html.div>
            <GlassButton label="Cancel" onPress={() => attempt.current?.abort()} fullWidth />
          </html.div>
        ) : (
          <GlassButton
            label="Connect"
            disabled={!complete}
            onPress={() => void connect()}
            prominent
            fullWidth
          />
        )}
        <html.p style={[textStyles.caption, styles.text]}>
          Only the iOS Simulator on the same Mac can connect. A physical iPhone isn't supported yet.
          The token is saved in this device's Keychain.
        </html.p>
      </html.div>
    </KeyboardAwareScrollView>
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

const inputStyle = {
  ...typography.title,
  flex: 1,
  color: nativeTheme.foreground,
  fontWeight: typography.body.fontWeight,
  paddingVertical: 0,
  minHeight: controls.touchTarget,
};

const styles = css.create({
  page: {
    paddingInline: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  text: { margin: 0 },
  wordmark: { fontWeight: typography.title.fontWeight },
  devices: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingBlock: spacing.sm,
  },
  deviceTile: {
    width: media.deviceTileSize,
    height: media.deviceTileSize,
    borderRadius: media.deviceTileRadius,
    backgroundColor: tokens.surface,
    borderWidth: controls.borderWidth,
    borderStyle: "solid",
    borderColor: tokens.border,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  linkDots: { display: "flex", flexDirection: "row", gap: spacing.xs },
  dot: {
    width: controls.statusDot,
    height: controls.statusDot,
    borderRadius: radii.pill,
    backgroundColor: tokens.accent,
  },
  intro: { gap: spacing.sm },
  lead: { color: tokens.muted, margin: 0 },
  form: {
    backgroundColor: tokens.surface,
    borderRadius: radii.card,
    borderWidth: controls.borderWidth,
    borderStyle: "solid",
    borderColor: tokens.border,
    paddingInline: spacing.lg,
  },
  field: { paddingBlock: spacing.xs },
  separator: { height: controls.borderWidth, backgroundColor: tokens.border },
  label: { color: tokens.muted, paddingTop: spacing.xs },
  control: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  actions: { gap: spacing.sm },
  progress: {
    minHeight: controls.primaryHeight,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
