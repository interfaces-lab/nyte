import type {
  MessageId,
  MoveOutcome,
  ReceiptId,
  RequestOptions,
  RunEnd,
  StopOutcome,
  UserStatus,
} from "@nyte-ai/schema";

export interface Receipt<Outcome> {
  readonly id: ReceiptId;

  status(): Promise<
    | { readonly kind: "pending" }
    | { readonly kind: "settled"; readonly outcome: Outcome }
    | { readonly kind: "missing" }
  >;

  settled(options?: RequestOptions): Promise<Outcome>;

  stop(): Promise<StopOutcome<Outcome>>;
}

export interface SendReceipt extends Receipt<
  RunEnd | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>
> {
  readonly message: MessageId;

  landed(): Promise<
    | Extract<UserStatus, { readonly kind: "landed" }>
    | { readonly kind: "withdrawn" }
    | Exclude<MoveOutcome, { readonly kind: "moved" }>
  >;
}
