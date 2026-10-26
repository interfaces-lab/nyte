import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, useColorScheme, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import Constants from "expo-constants";
import { useFocusEffect, useIsFocused } from "expo-router";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { shell } from "@nyte-ai/canvas/shell-inline";
import {
  CANVAS_DEFAULT_HEIGHT,
  CANVAS_RUNTIME,
  canvasStartHeight,
  hostContextChangedNotification,
  initializeResult,
  libraryResult,
  openLinkResult,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";
import { controls, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { mobileHostContext, shellEffect, shellScript, startupScript } from "./canvas-host.ts";
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

type Frame = { readonly height: number; readonly scrolls: boolean };

/**
 * `fit` sizes the view to the canvas up to the height cap and scrolls only past it; `fill` takes its
 * parent's height and always scrolls.
 */
type CanvasSize =
  | (Frame & { readonly kind: "fit"; readonly onResize: (frame: Frame) => void })
  | { readonly kind: "fill" };

/**
 * A canvas in the transcript: a card whose height follows the canvas, and until it reports one, the
 * height a preview measured at the card's width (the window's before layout). While the card's own full
 * screen is open, its WebView is torn down so the phone runs one copy of the canvas, and the card
 * keeps its height so the transcript doesn't move; it loads again when the chat is back in front.
 */
export function CanvasFrame({
  item,
  onReport,
  onExpand,
}: {
  item: Extract<ChatRow, { kind: "canvas" }>;
  onReport: (message: string) => void;
  onExpand: () => void;
}) {
  const theme = useTheme();
  const focused = useIsFocused();
  const [expanded, setExpanded] = useState(false);

  const windowWidth = useWindowDimensions().width;
  const [width, setWidth] = useState<number>();
  const [frame, setFrame] = useState<Frame>();
  const height = frame?.height ?? canvasStartHeight(item, width ?? windowWidth);

  useFocusEffect(() => setExpanded(false));

  return (
    <html.div style={styles.card}>
      <html.div style={styles.header}>
        <SymbolView name="rectangle.3.group" size={controls.iconSm} tintColor={theme.muted} />
        <html.span style={[textStyles.label, styles.title]}>{item.title}</html.span>
        {item.runtime > CANVAS_RUNTIME ? null : (
          <html.button
            aria-label="Open Full Screen"
            onClick={() => {
              setExpanded(true);
              onExpand();
            }}
            style={styles.expand}
          >
            <SymbolView
              name="arrow.up.left.and.arrow.down.right"
              size={controls.iconSm}
              tintColor={theme.muted}
            />
          </html.button>
        )}
      </html.div>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {expanded && !focused ? (
          <View style={{ height }} />
        ) : (
          <CanvasWebView
            canvas={item}
            size={{ kind: "fit", height, scrolls: frame?.scrolls ?? false, onResize: setFrame }}
            onReport={onReport}
          />
        )}
      </View>
    </html.div>
  );
}

/**
 * The canvas runtime shell in a WebView, speaking its protocol: the card in the transcript and the
 * full-screen screen both draw a canvas through it. A content process that dies is restarted once;
 * a second death is shown instead.
 */
export function CanvasWebView({
  canvas,
  size,
  onReport,
}: {
  canvas: Pick<CanvasState, "runtime" | "title" | "code" | "error">;
  size: CanvasSize;
  onReport: (message: string) => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const webView = useRef<WebView<unknown>>(null);
  const crashed = useRef(false);
  const reported = useRef<string>(undefined);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const scrolls = size.kind === "fill" || size.scrolls;

  const [failure, setFailure] = useState<{ code: string; message: string; fatal: boolean }>();
  const shown = failure?.code === canvas.code ? failure : undefined;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- injects the module into the WebView shell on load and change
  useEffect(() => {
    if (!ready) return;
    inject(
      webView.current,
      renderNotification({ runtime: canvas.runtime, code: canvas.code, title: canvas.title }),
    );
  }, [ready, canvas.runtime, canvas.code, canvas.title]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- injects the color scheme into the WebView shell
  useEffect(() => {
    if (ready) inject(webView.current, hostContextChangedNotification({ theme: scheme }));
  }, [ready, scheme]);

  const fail = (message: string) => {
    setFailure({ code: canvas.code, message, fatal: false });

    if (reported.current === message || canvas.error === message) return;
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
        if (size.kind === "fit") size.onResize({ height: effect.height, scrolls: effect.scrolls });
        break;
      case "open-link":
        void openExternalLink(effect.url).then((opened) =>
          inject(webView.current, openLinkResult(effect.id, !opened)),
        );
        break;
      case "library":
        inject(webView.current, libraryResult(effect.name, shell.libraries[effect.name]));
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
      setFailure({ code: canvas.code, message: STOPPED, fatal: true });

      return;
    }

    crashed.current = true;
    setReady(false);
    setGeneration((current) => current + 1);
  };

  if (canvas.runtime > CANVAS_RUNTIME) return <Notice>Update Nyte to see this canvas.</Notice>;

  if (shown?.fatal === true) return <Notice>{shown.message}</Notice>;

  return (
    <>
      <View style={size.kind === "fit" ? { height: size.height } : { flex: 1 }}>
        <WebView<unknown>
          key={generation}
          ref={webView}
          source={{ html: shell.html }}
          injectedJavaScriptBeforeContentLoaded={startupScript(scheme)}
          originWhitelist={EVERY_ORIGIN}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          onMessage={onMessage}
          onOpenWindow={(event) => void openExternalLink(event.nativeEvent.targetUrl)}
          onContentProcessDidTerminate={restart}
          scrollEnabled={scrolls}
          bounces={size.kind === "fill"}
          showsVerticalScrollIndicator={scrolls}
          showsHorizontalScrollIndicator={false}
          automaticallyAdjustContentInsets={false}
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          accessibilityLabel={canvas.title}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
        {ready ? null : (
          <html.div style={styles.loading}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        )}
      </View>
      {shown === undefined ? null : (
        <html.div role="status" style={styles.failure}>
          <SymbolView
            name="exclamationmark.circle"
            size={controls.iconSm}
            tintColor={theme.danger}
          />
          <html.span style={[textStyles.caption, styles.failureText]}>{shown.message}</html.span>
        </html.div>
      )}
    </>
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
    minHeight: controls.touchTarget,
    paddingInline: 14,
  },
  title: { flexGrow: 1, flexShrink: 1, lineClamp: 1 },
  // The 44pt target reaches the card's edge so its glyph lines up with the header's inset.
  expand: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: controls.touchTarget,
    height: controls.touchTarget,
    marginInlineEnd: -14,
    borderWidth: 0,
    padding: 0,
    backgroundColor: "transparent",
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
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
