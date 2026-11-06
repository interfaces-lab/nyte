import type { FixtureServer } from "@nyte-ai/bench";

/** `bad` reproduces a mistake an agent made in Nyte, `guard` protects the right call next to it, `control` is ordinary work that must not change. */
export type CaseKind = "bad" | "guard" | "control";

export interface Expectation {
  /** Rounds of tool calls the chat's first turn may take, one model request each before its answer; 1 when absent. More, or any call of the chat's that fails, fails the sample. */
  readonly rounds?: number;
  /** Tools that need at least one call that ended ok. */
  readonly calls?: readonly string[];
  /** Tools that must not be called at all, by the chat or its subagents. */
  readonly callsMustNot?: readonly RegExp[];
  /** Fixture MCP tools, as `server/tool`, that must have served a call. */
  readonly served?: readonly string[];
  /** Fixture MCP servers that must not have served any call. */
  readonly servedMustNot?: readonly string[];
  /** Text the chat's last message holds, case-insensitively. */
  readonly answer?: readonly string[];
}

/** One prompt to a fresh chat, the world it runs in, and what the chat must do. */
export interface BenchCase {
  readonly id: string;
  readonly kind: CaseKind;
  /** The mistake or the behaviour the case keeps, in a sentence. */
  readonly experience: string;
  readonly prompt: string;
  /** Fixture MCP servers the home's `mcp.json` names. */
  readonly servers: Readonly<Record<string, FixtureServer>>;
  /** Files in the chat's workspace, by name. */
  readonly files: Readonly<Record<string, string>>;
  readonly expect: Expectation;
}

/** A set of cases that measure one part of the harness. */
export interface Suite {
  readonly id: string;
  readonly title: string;
  readonly cases: readonly BenchCase[];
}
