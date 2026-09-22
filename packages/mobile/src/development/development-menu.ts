import type { NyteClient } from "@nyte-ai/client";
import { MAIN, sessionId, type SessionInfo } from "@nyte-ai/protocol";
import { isLiveActivityActive, startLiveActivity, stopLiveActivity } from "@use-voltra/ios-client";
import { registerDevMenuItems } from "expo-dev-client";
import { router, useGlobalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Alert } from "react-native";
import { workLiveActivityVariants } from "../activity/live-activity.tsx";

const PREVIEW_ACTIVITY = "nyte-dev-preview";

const SCREENS = [
  { name: "Open Agents", pathname: "/" },
  { name: "Open Settings", pathname: "/settings" },
  { name: "Open conversation", pathname: "/chat/[id]" },
  { name: "Open review", pathname: "/review/[id]" },
  { name: "Open changed files", pathname: "/changes/[id]" },
] as const;

function reportError(cause: unknown) {
  Alert.alert("Development action failed", cause instanceof Error ? cause.message : String(cause));
}

async function showActivityPreview(kind: "working" | "attention") {
  if (!__DEV__) return;

  const startedAt = Date.now() - 60_000;

  const session = {
    sessionId: sessionId(PREVIEW_ACTIVITY),
    name: "Live Activity preview",
    activation: { kind: "active" },
    createdAt: startedAt,
    lastActivityAt: startedAt,
    pinned: false,
    archived: false,
    config: {},
    heads: [
      {
        head: MAIN,
        tip: null,
        run: {
          runId: PREVIEW_ACTIVITY,
          head: MAIN,
          origin: { kind: "user" },
          root: PREVIEW_ACTIVITY,
          phase: { kind: kind === "working" ? "respond" : "waiting" },
          awaitingReply: kind === "attention" ? true : undefined,
          startedAt,
          attempts: 1,
          config: {},
        },
      },
    ],
  } satisfies SessionInfo;

  const variants = workLiveActivityVariants(
    kind === "working" ? [session] : [],
    kind === "attention" ? [session] : [],
  );

  await startLiveActivity(variants, { activityName: PREVIEW_ACTIVITY, deepLinkUrl: "nyte://" });
}

export function DevelopmentMenu({ client }: { client: NyteClient | undefined }) {
  const { id } = useGlobalSearchParams<{ id?: string | string[] }>();
  const currentId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!__DEV__) return;

    const openScreen = async (pathname: (typeof SCREENS)[number]["pathname"]) => {
      if (client === undefined) throw new Error("Connect your Mac first.");

      if (pathname === "/" || pathname === "/settings") {
        router.navigate(pathname);

        return;
      }

      const selected =
        currentId === undefined
          ? (await client.sessions.list({ parent: null, limit: 1 })).items[0]?.sessionId
          : sessionId(currentId);

      if (selected === undefined) throw new Error("There are no conversations on your Mac.");

      router.navigate({ pathname, params: { id: selected } });
    };

    void registerDevMenuItems([
      ...SCREENS.map(({ name, pathname }) => ({
        name,
        shouldCollapse: true,
        callback: () => {
          void openScreen(pathname).catch(reportError);
        },
      })),
      {
        name: "Live Activity: working preview",
        shouldCollapse: true,
        callback: () => {
          void showActivityPreview("working").catch(reportError);
        },
      },
      {
        name: "Live Activity: needs input preview",
        shouldCollapse: true,
        callback: () => {
          void showActivityPreview("attention").catch(reportError);
        },
      },
      {
        name: "Stop Live Activity preview",
        shouldCollapse: true,
        callback: () => {
          if (isLiveActivityActive(PREVIEW_ACTIVITY)) {
            void stopLiveActivity(PREVIEW_ACTIVITY, { dismissalPolicy: "immediate" }).catch(
              reportError,
            );
          }
        },
      },
    ]).catch(reportError);

    return () => {
      void registerDevMenuItems([]).catch(reportError);
    };
  }, [client, currentId]);

  return null;
}
