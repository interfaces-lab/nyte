import type { RequestOptions, RunEnd, RunId, StopOutcome } from "@nyte-ai/schema";

export interface Run {
  readonly id: RunId;

  stop(): Promise<StopOutcome<RunEnd>>;

  settled(options?: RequestOptions): Promise<RunEnd>;
}
