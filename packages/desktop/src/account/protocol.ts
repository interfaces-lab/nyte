import type { AccountAnswer, AccountReport } from "./policy.ts";

export type { AccountAnswer, AccountReport } from "./policy.ts";

export const ACCOUNT_CHANNELS = {
  config: "nyte-account:config",
  ready: "nyte-account:ready",
  command: "nyte-account:command",
  answer: "nyte-account:answer",
  report: "nyte-account:report",
} as const;

export interface AccountConfig {
  readonly publishableKey: string;
}

/** The one operation main is waiting on. A newer one replaces it. */
export interface AccountCommand {
  readonly id: string;
  readonly kind: "token" | "sign_out";
}

/** Fixed reasons, so the page never chooses text main shows. */
export type AccountFailure = Extract<AccountAnswer, { kind: "failed" }>["reason"];

export interface AccountBridge {
  config(): Promise<AccountConfig | undefined>;
  /** Delivers the pending command now and whenever it changes; `undefined` means none. */
  onCommand(listener: (command: AccountCommand | undefined) => void): () => void;
  answer(answer: AccountAnswer): void;
  report(report: AccountReport): void;
}
