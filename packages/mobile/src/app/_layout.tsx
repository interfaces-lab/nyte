import { useState } from "react";
import { ActivityIndicator, AppState, StatusBar, StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import { css, html } from "react-strict-dom";
import type { NyteClient } from "@nyte-ai/client";
import { ConnectScreen } from "../connection/connect-screen.tsx";
import type { Connection } from "../connection/connection.ts";
import { HostProvider, useHostConnection } from "../connection/host-context.tsx";
import { useAppliedAppearance } from "../settings/preferences.ts";
import { useTheme, spacing, tokens, typography } from "../theme.ts";
import { Toaster } from "../ui/toast.tsx";
import { DevelopmentMenu } from "../development/development-menu.ts";

export const unstable_settings = { anchor: "index" };

// Queries refetch on window focus; on a phone that means the app coming forward.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state) =>
    handleFocus(state === "active"),
  );

  return () => subscription.remove();
});

export default function RootLayout() {
  useAppliedAppearance();
  // A new host means a new cache: another Mac's sessions are not this one's.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}

function Gate() {
  const theme = useTheme();
  const dark = useColorScheme() === "dark";
  const { host, connect, edit, cancelEdit, disconnect } = useHostConnection();
  const base = dark ? DarkTheme : DefaultTheme;

  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.background,
      card: theme.background,
      text: theme.foreground,
      primary: theme.foreground,
      border: theme.border,
    },
  };

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={layoutRoot.fill}>
        <KeyboardProvider>
          <ThemeProvider value={navigationTheme}>
            {__DEV__ ? (
              <DevelopmentMenu client={host.kind === "connected" ? host.client : undefined} />
            ) : null}
            <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
            {host.kind === "loading" ? (
              <html.div style={[styles.root, styles.centered]}>
                <ActivityIndicator color={theme.muted} />
              </html.div>
            ) : host.kind === "setup" ? (
              <html.div style={styles.root}>
                <ConnectScreen
                  onConnect={connect}
                  edit={
                    host.editing === undefined
                      ? undefined
                      : { connection: host.editing.connection, onCancel: cancelEdit }
                  }
                  notice={host.notice}
                />
              </html.div>
            ) : (
              <Connected
                key={host.connection.url}
                session={{
                  client: host.client,
                  connection: host.connection,
                  edit,
                  disconnect,
                }}
              />
            )}
            <Toaster />
          </ThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

/**
 * The connected half of the gate. Its own QueryClient means a different Mac can
 * never see the previous one's cached sessions, models, or workspaces — the
 * `key` on the call site remounts this when the connection target changes.
 */
function Connected({
  session,
}: {
  session: {
    client: NyteClient;
    connection: Connection;
    edit: () => void;
    disconnect: () => Promise<void>;
  };
}) {
  const theme = useTheme();
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <HostProvider session={session}>
        <Stack
          screenOptions={{
            headerTransparent: false,
            headerShadowVisible: false,
            headerLargeTitleShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            headerTintColor: theme.foreground,
            headerTitleStyle: {
              color: theme.foreground,
              fontSize: typography.title.fontSize,
              fontWeight: "600",
            },
            headerLargeTitleStyle: {
              color: theme.foreground,
              fontSize: typography.heading.fontSize,
              fontWeight: "600",
            },
            headerStyle: { backgroundColor: theme.background },
            headerLargeStyle: { backgroundColor: theme.background },
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: "Agents", headerLargeTitleEnabled: true }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen
            name="chat/[id]"
            options={{
              title: "",
              // The transcript scrolls under a glass bar; the title rides on it.
              headerTransparent: true,
              headerBlurEffect: "systemChromeMaterial",
              headerStyle: { backgroundColor: "transparent" },
            }}
          />
          <Stack.Screen name="changes/[id]" options={{ title: "Changed Files" }} />
          <Stack.Screen name="review/[id]" options={{ title: "" }} />
          <Stack.Screen
            name="annotate"
            options={{ presentation: "fullScreenModal", headerShown: false }}
          />
        </Stack>
      </HostProvider>
    </QueryClientProvider>
  );
}

const layoutRoot = StyleSheet.create({
  fill: { flex: 1 },
});

const styles = css.create({
  // The screen's own box: its parent is the native root, not a flex container,
  // so it fills by size rather than by growing inside one.
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.background,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
