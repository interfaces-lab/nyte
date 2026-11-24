import type { HookHandler, Plugin } from "@nyte-ai/plugin/core";

type Contributions = NonNullable<Plugin["contribute"]>;

export interface Mode {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly color: string;
  readonly prompt: string;
  readonly tools?: Contributions["tools"];
  readonly parts?: Contributions["parts"];
  readonly commands?: Contributions["commands"];
  readonly onRunEnded?: HookHandler<"run_ended">;
}
