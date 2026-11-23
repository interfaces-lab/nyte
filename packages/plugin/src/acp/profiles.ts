import type { InitializeResponse } from "@agentclientprotocol/sdk/unstable";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  antigravityCodec,
  claudeCodec,
  copilotCodec,
  devinCodec,
  readMeta,
  standardCodec,
} from "./codecs/agents.ts";
import type { Dialect } from "./codecs/agents.ts";

export interface AcpLaunch {
  readonly args: readonly string[];
  readonly mode?: string;
}

export interface AgentBehavior {
  readonly codec: () => Dialect;
  readonly replies: "prompt-only" | "usage-end";
  readonly mcp: "negotiate" | "stdio-only" | "http-only";
  readonly files: "off" | "confined";
  readonly terminal: "off" | "shell";
  readonly systemAppend: boolean;
  readonly handoff: boolean;
  readonly load: "off" | "response";
}

export interface AcpAgent {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly launch: AcpLaunch;
  readonly unattended?: AcpLaunch;
  readonly auth?: string;
  readonly behavior?: AgentBehavior;
}

export const standardProfile: AgentBehavior = {
  codec: () => standardCodec,
  replies: "prompt-only",
  mcp: "negotiate",
  files: "off",
  terminal: "off",
  systemAppend: false,
  handoff: false,
  load: "off",
};

export const antigravityProfile: AgentBehavior = {
  ...standardProfile,
  codec: antigravityCodec,
  replies: "usage-end",
  mcp: "stdio-only",
  files: "confined",
  systemAppend: true,
  handoff: true,
};

export const claudeProfile: AgentBehavior = { ...standardProfile, codec: claudeCodec };

export const copilotProfile: AgentBehavior = {
  ...standardProfile,
  codec: copilotCodec,
  mcp: "http-only",
};

export const devinProfile: AgentBehavior = {
  ...standardProfile,
  codec: devinCodec,
  mcp: "stdio-only",
  terminal: "shell",
};

export interface AgentContract {
  readonly reopen: "resume" | "load" | "off";
  readonly close: boolean;
  readonly images: boolean;
  readonly replies: AgentBehavior["replies"];
  readonly systemAppend: boolean;
  readonly handoff: boolean;
}

const antigravityAppend = Type.Object({
  antigravity: Type.Object({ systemPrompt: Type.Object({ append: Type.Literal(true) }) }),
});

export function negotiate(profile: AgentBehavior, peer: InitializeResponse): AgentContract {
  const capabilities = peer.agentCapabilities;

  const version = peer.agentInfo?.version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  const major = Number(version?.[1]);
  const minor = Number(version?.[2]);

  return {
    reopen:
      capabilities?.sessionCapabilities?.resume != null
        ? "resume"
        : capabilities?.loadSession === true && profile.load === "response"
          ? "load"
          : "off",
    close: capabilities?.sessionCapabilities?.close != null,
    images: capabilities?.promptCapabilities?.image === true,
    replies: profile.replies,
    systemAppend: profile.systemAppend && Value.Check(antigravityAppend, readMeta(capabilities)),
    handoff: profile.handoff && version !== null && (major > 1 || (major === 1 && minor >= 5)),
  };
}
