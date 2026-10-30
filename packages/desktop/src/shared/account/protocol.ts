import type { AccountAnswer, AccountReport } from "./policy.ts";

export type { AccountAnswer, AccountReport } from "./policy.ts";

export const ACCOUNT_CHANNELS = {
  config: "nyte-account:config",
  ready: "nyte-account:ready",
  command: "nyte-account:command",
  answer: "nyte-account:answer",
  report: "nyte-account:report",
  returned: "nyte-account:returned",
} as const;

export interface AccountConfig {
  readonly publishableKey: string;
}

export interface AccountCommand {
  readonly id: string;
  readonly kind: "token" | "sign_out";
}

export type AccountFailure = Extract<AccountAnswer, { kind: "failed" }>["reason"];

export interface AccountBridge {
  config(): Promise<AccountConfig | undefined>;
  onCommand(listener: (command: AccountCommand | undefined) => void): () => void;
  onReturn(listener: () => void): () => void;
  answer(answer: AccountAnswer): void;
  report(report: AccountReport): void;
}
