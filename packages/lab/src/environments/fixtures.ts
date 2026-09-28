import type { ComponentProps } from "react";
import type { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import type { IconName } from "@nyte-ai/ui/icon";

export type SessionMark = ComponentProps<typeof StatusDot>["mark"];

export const SURFACES = ["desktop", "web"] as const;

export type Surface = (typeof SURFACES)[number];

export interface LabChat {
  readonly title: string;
  readonly mark: SessionMark;
  readonly elapsed: string;
  /** The question or failure a row that needs you carries on its second line. */
  readonly ask?: string;
}

export interface LabFolder {
  readonly name: string;
  readonly chats: readonly LabChat[];
}

export interface LabEnvironment {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** How this surface reaches it. This Mac has no reach; it is the surface itself. */
  readonly reach: string | undefined;
  readonly online: boolean;
  /** Cloud has no folders, so its chats sit straight under the header. */
  readonly folders: readonly LabFolder[] | undefined;
  readonly chats: readonly LabChat[];
}

function chat(title: string, mark: SessionMark, elapsed: string, ask?: string): LabChat {
  return { title, mark, elapsed, ask };
}

const thisMac: LabEnvironment = {
  id: "this-mac",
  name: "This Mac",
  icon: "computer",
  reach: undefined,
  online: true,
  folders: [
    {
      name: "nyte",
      chats: [
        chat("Environment picker in new chat", "working", "2m"),
        chat("Split popover shadow tiers", "idle", "40m"),
      ],
    },
    { name: "Home", chats: [chat("Draft release notes", "idle", "3h")] },
  ],
  chats: [],
};

const studio: LabEnvironment = {
  id: "studio",
  name: "Studio Mac",
  icon: "devices",
  reach: "Tailscale",
  online: true,
  folders: [
    {
      name: "nyte",
      chats: [
        chat("Run e2e remote-access suite", "working", "6m"),
        chat("Confirm pairing copy", "waiting", "1m", "Asked which wording to keep"),
      ],
    },
    { name: "website", chats: [chat("Hero video compression", "idle", "1d")] },
  ],
  chats: [],
};

const laptop: LabEnvironment = {
  id: "laptop",
  name: "Work MacBook",
  icon: "devices",
  reach: "Tailscale",
  online: false,
  folders: [
    {
      name: "api",
      chats: [chat("Payments retry backoff", "failed", "5h", "Typecheck failed in retry.ts")],
    },
  ],
  chats: [],
};

const cloud: LabEnvironment = {
  id: "cloud",
  name: "Cloud",
  icon: "cloud",
  reach: "nyte.example.dev",
  online: true,
  folders: undefined,
  chats: [
    chat("Nightly dependency audit", "idle", "8h"),
    chat("Triage Linear inbox", "working", "3m"),
  ],
};

/**
 * The desktop always has This Mac. Web and mobile have no machine of their
 * own, so their list is only what they paired with.
 */
export function environmentsFor(surface: Surface, several: boolean): readonly LabEnvironment[] {
  if (surface === "desktop") return several ? [thisMac, studio, laptop, cloud] : [thisMac];

  return several ? [studio, laptop, cloud] : [studio];
}

export interface LabRow extends LabChat {
  readonly environment: LabEnvironment;
  readonly folder: string | undefined;
}

/** Needs you, then running, then finished: the production sidebar's status ranking. */
const RANK = {
  waiting: 0,
  failed: 0,
  retry: 1,
  working: 1,
  idle: 2,
} as const satisfies Readonly<Record<SessionMark, number>>;

/** One list across every environment and folder, like the shipping Chats list. */
export function rowsOf(environments: readonly LabEnvironment[]): readonly LabRow[] {
  return environments
    .flatMap((environment) => [
      ...(environment.folders ?? []).flatMap((folder) =>
        folder.chats.map((chat) => ({ ...chat, environment, folder: folder.name })),
      ),
      ...environment.chats.map((chat) => ({ ...chat, environment, folder: undefined })),
    ])
    .toSorted((left, right) => RANK[left.mark] - RANK[right.mark]);
}
