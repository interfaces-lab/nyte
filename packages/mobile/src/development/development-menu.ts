import { asId } from "@nyte-ai/schema";
import type { Connection, SessionInfo } from "@nyte-ai/sdk";
import { isLiveActivityActive, startLiveActivity, stopLiveActivity } from "@use-voltra/ios-client";
import { registerDevMenuItems } from "expo-dev-client";
import { router, useGlobalSearchParams } from "expo-router";
// oxlint-disable-next-line no-restricted-imports -- dev menu items re-register when the client or conversation changes
import { useEffect } from "react";
import { Alert } from "react-native";
import { appLink, workLiveActivityVariants } from "../activity/live-activity.tsx";
import { sessionIdOf } from "../view-helpers.ts";

const PREVIEW_ACTIVITY = "nyte-dev-preview";

const SCREENS = [
  { name: "Open Inbox", pathname: "/" },
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

  const main = asId<"head">("main");

  const run = {
    id: asId<"run">(PREVIEW_ACTIVITY),
    head: main,
    startedAt,
    attempt: 1,
    configuration: {
      kind: "exact",
      model: { provider: "preview", id: "preview" },
      thinking: "off",
      agent: null,
      settings: {},
      settingsVersion: "preview",
    },
    origin: { kind: "continuation", from: "wake" },
  } as const;

  const session = {
    id: asId<"session">(PREVIEW_ACTIVITY),
    name: "Live Activity preview",
    parent: null,
    call: null,
    workspace: asId<"workspace">("fixture"),
    activation: { kind: "active" },
    createdAt: startedAt,
    lastActivityAt: startedAt,
    pinned: false,
    archived: false,
    heads: [
      {
        name: main,
        tip: { kind: "start" },
        stack: null,
        unread: false,
        execution:
          kind === "working"
            ? { kind: "live", run, phase: "responding", stopping: false }
            : { kind: "waiting", run, on: { kind: "part", part: asId<"part">(PREVIEW_ACTIVITY) } },
      },
    ],
  } satisfies SessionInfo;

  const variants = workLiveActivityVariants(
    kind === "working" ? [session] : [],
    kind === "attention" ? [session] : [],
  );

  await startLiveActivity(variants, { activityName: PREVIEW_ACTIVITY, deepLinkUrl: appLink("") });
}

export function DevelopmentMenu({ client }: { client: Connection | undefined }) {
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
          ? (await client.sessions.list({ parents: { kind: "roots" }, limit: 1 })).items[0]?.id
          : sessionIdOf(currentId);

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
