import type { MessageId, MoveOutcome, ReceiptId, RequestOptions, RunEnd, StopOutcome, UserStatus } from "@nyte-ai/schema";

/**
 * Returns a handle on one durable command: its status, its settlement and
 * its stop.
 *
 * **Details**
 *
 * One receipt for every durable command. The rule: if the work continues
 * after the call returns and nothing in the view stands for it, it returns a
 * receipt; otherwise it returns its outcome.
 *
 * - receipts: `send` (the run), `move` (a summary may be written),
 *   `files.batch().apply()` (the batch).
 * - outcomes: `configure`, `heads.create`, `heads.merge`, `heads.remove`,
 *   `update`, git writes, parts, and `compact`, whose work is a part the
 *   view already shows.
 *
 * Withdraw is stop before landing; there is no second verb.
 *
 * **Example** (Reacquiring a receipt after a restart)
 *
 * ```ts
 * declare const session: Session;
 * declare const saved: ReceiptId;
 *
 * const receipt = session.receipt(saved);
 * const status = await receipt.status();
 * if (status.kind === "pending") {
 *   const outcome = await receipt.settled({ signal: AbortSignal.timeout(30_000) });
 * }
 * ```
 *
 * @see {@link SendReceipt}
 * @category receipts
 * @since 0.1.0
 */
export interface Receipt<Outcome> {
  /** Minted inside; pass it to retry across your own restart, or to `session.receipt(id)`. */
  readonly id: ReceiptId;
  /**
   * Returns whether the command is pending, settled with its outcome, or
   * unknown to the host.
   *
   * @authority participant
   */
  status(): Promise<{ readonly kind: "pending" } | { readonly kind: "settled"; readonly outcome: Outcome } | { readonly kind: "missing" }>;
  /**
   * Waits for the outcome. Abort stops the wait, never the work.
   *
   * @throws {SdkError} unknown when the host does not have this id.
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<Outcome>;
  /**
   * Requests a durable stop of the work where it can be stopped.
   *
   * @returns {@link StopOutcome}
   * @authority participant
   */
  stop(): Promise<StopOutcome<Outcome>>;
}

/**
 * Returns the receipt for a send: the message id plus a wait for landing.
 *
 * **Details**
 *
 * Settles with how the run ended, `withdrawn`, or the move failure of an
 * edit. Before landing `stop()` withdraws; after landing it equals
 * `run(landed.run).stop()` and so stops a shared steered run too.
 *
 * @category receipts
 * @since 0.1.0
 */
export interface SendReceipt extends Receipt<RunEnd | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>> {
  /** The same id as the receipt. Everything admission decided is on the message: delivery, schedule, status, siblings, configuration. */
  readonly message: MessageId;
  /**
   * Waits until the message lands, is withdrawn, or its edit fails to move.
   *
   * @authority participant
   */
  landed(): Promise<Extract<UserStatus, { readonly kind: "landed" }> | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>>;
}
