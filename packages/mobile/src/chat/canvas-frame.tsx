import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, useColorScheme } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import Constants from "expo-constants";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { shell } from "@nyte-ai/canvas/shell-inline";
import {
  CANVAS_DEFAULT_HEIGHT,
  CANVAS_RUNTIME,
  clampCanvasHeight,
  hostContextChangedNotification,
  initializeResult,
  openLinkResult,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import { controls, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { mobileHostContext, shellEffect, shellScript } from "./canvas-host.ts";
import type { ShellBound } from "./canvas-host.ts";
import { openExternalLink } from "./markdown.tsx";
import type { ChatRow } from "./transcript-rows.ts";

const HOST_INFO = {
  name: "nyte-ios",
  version: Constants.expoConfig?.version ?? "0.0.0",
} as const;

/**
 * Every navigation reaches onShouldStartLoadWithRequest, which keeps only the shell's own document; a
 * narrower whitelist would hand anything else to the system opener instead.
 */
const EVERY_ORIGIN = ["*"];

const STOPPED = "This canvas stopped responding.";

function inject(view: WebView<unknown> | null, message: ShellBound): void {
  view?.injectJavaScript(shellScript(message));
}

export function CanvasFrame({
  item,
  onReport,
}: {
  item: Extract<ChatRow, { kind: "canvas" }>;
  onReport: (message: string) => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const webView = useRef<WebView<unknown>>(null);
  const crashed = useRef(false);
  const reported = useRef<string>(undefined);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);

  const [frame, setFrame] = useState({
    height: clampCanvasHeight(item.height ?? CANVAS_DEFAULT_HEIGHT),
    scrolls: false,
  });

  const [failure, setFailure] = useState<{ code: string; message: string; fatal: boolean }>();
  const shown = failure?.code === item.code ? failure : undefined;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- injects the module into the WebView shell on load and change
  useEffect(() => {
    if (!ready) return;
    inject(
      webView.current,
      renderNotification({ runtime: item.runtime, code: item.code, title: item.title }),
    );
  }, [ready, item.runtime, item.code, item.title]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- injects the color scheme into the WebView shell
  useEffect(() => {
    if (ready) inject(webView.current, hostContextChangedNotification({ theme: scheme }));
  }, [ready, scheme]);

  const fail = (message: string) => {
    setFailure({ code: item.code, message, fatal: false });

    if (reported.current === message || item.error === message) return;
    reported.current = message;
    onReport(message);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const effect = shellEffect(event.nativeEvent.data);

    if (effect === undefined) return;

    switch (effect.kind) {
      case "initialize":
        inject(webView.current, initializeResult(effect.id, HOST_INFO, mobileHostContext(scheme)));
        break;
      case "ready":
        setReady(true);
        break;
      case "height":
        setFrame({ height: effect.height, scrolls: effect.scrolls });
        break;
      case "open-link":
        void openExternalLink(effect.url).then((opened) =>
          inject(webView.current, openLinkResult(effect.id, !opened)),
        );
        break;
      case "error":
        fail(effect.message);
        break;
      default: {
        const exhaustive: never = effect;

        return exhaustive;
      }
    }
  };

  const restart = () => {
    if (crashed.current) {
      setReady(false);
      setFailure({ code: item.code, message: STOPPED, fatal: true });

      return;
    }

    crashed.current = true;
    setReady(false);
    setGeneration((current) => current + 1);
  };

  return (
    <html.div style={styles.card}>
      <html.div style={styles.header}>
        <SymbolView name="rectangle.3.group" size={controls.iconSm} tintColor={theme.muted} />
        <html.span style={[textStyles.label, styles.title]}>{item.title}</html.span>
      </html.div>
      {item.runtime > CANVAS_RUNTIME ? (
        <Notice>Update Nyte to see this canvas.</Notice>
      ) : shown?.fatal ? (
        <Notice>{shown.message}</Notice>
      ) : (
        <View style={{ height: frame.height }}>
          <WebView<unknown>
            key={generation}
            ref={webView}
            source={{ html: shell.html }}
            originWhitelist={EVERY_ORIGIN}
            onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
            onMessage={onMessage}
            onOpenWindow={(event) => void openExternalLink(event.nativeEvent.targetUrl)}
            onContentProcessDidTerminate={restart}
            scrollEnabled={frame.scrolls}
            bounces={false}
            showsVerticalScrollIndicator={frame.scrolls}
            showsHorizontalScrollIndicator={false}
            automaticallyAdjustContentInsets={false}
            allowsLinkPreview={false}
            dataDetectorTypes="none"
            accessibilityLabel={item.title}
            style={{ flex: 1, backgroundColor: "transparent" }}
          />
          {ready ? null : (
            <html.div style={styles.loading}>
              <ActivityIndicator color={theme.muted} />
            </html.div>
          )}
        </View>
      )}
      {shown === undefined || shown.fatal ? null : (
        <html.div role="status" style={styles.failure}>
          <SymbolView
            name="exclamationmark.circle"
            size={controls.iconSm}
            tintColor={theme.danger}
          />
          <html.span style={[textStyles.caption, styles.failureText]}>{shown.message}</html.span>
        </html.div>
      )}
    </html.div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <html.div role="status" style={styles.notice}>
      <html.span style={[textStyles.secondary, styles.centered]}>{children}</html.span>
    </html.div>
  );
}

const styles = css.create({
  card: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.canvas,
    borderRadius: radii.card,
    borderWidth: controls.hairline,
    borderColor: tokens.border,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingInline: 14,
    paddingTop: 10,
    paddingBottom: spacing.sm,
  },
  title: { flexShrink: 1, lineClamp: 1 },
  loading: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  notice: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: CANVAS_DEFAULT_HEIGHT,
    paddingInline: 14,
    paddingBottom: spacing.md,
  },
  centered: { textAlign: "center" },
  failure: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingInline: 14,
    paddingBlock: 10,
  },
  failureText: { flexShrink: 1, color: tokens.danger },
});
