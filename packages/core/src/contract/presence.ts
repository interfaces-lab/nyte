import type { Revision } from "@nyte-ai/schema";
import type { StoreConnection } from "./store.ts";

export interface Member {
  readonly label: string;
  readonly pid: number | null;
  readonly capabilities: readonly string[];
}

export type Holder =
  | { readonly kind: "me" }
  | { readonly kind: "absent" }
  | { readonly kind: "alive"; readonly until: number }
  | { readonly kind: "dead"; readonly name: string; readonly expect: Revision };

export interface Presence {
  readonly instance: string;
  readonly member: Member;
  readonly store: StoreConnection;
  readonly revoked: AbortSignal;
  holder(instance: string): Promise<Holder>;
  sweep(): Promise<void>;
  close(leases?: readonly { readonly name: string; readonly expect: Revision }[]): Promise<void>;
}
