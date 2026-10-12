import type { Schema } from "./schema.ts";

/**
 * Names the authority a served operation needs.
 *
 * **Details**
 *
 * Authority is three words. Every declaration names the authority it needs;
 * `authorize` names what a principal has; the listener answers denied for the
 * rest, and the client sees Capability denied where a namespace is gated.
 *
 * - `participant`: sessions, parts, watches.
 * - `owner`: workspaces, providers, settings, git writes.
 * - `maintenance`: `plugins.*` and `principals.*`.
 *
 * `inspect`, `prune` and `execution` are in-process only and have no
 * authority. A token principal has participant + owner.
 *
 * @category host
 * @since 0.1.0
 */
export type Authority = "participant" | "owner" | "maintenance";

/**
 * Describes one served operation: its schemas, kind, authority, scope and
 * recovery.
 *
 * **Details**
 *
 * One table is the source of every generated artifact: the client Connection
 * types, the listener's route table, codecs, the catalog a non-TS client
 * reads, and authority gating. There is no second schema for the wire: input
 * and output schemas are the wire records; handles are bound on the client
 * from returned ids.
 *
 * **Example** (Declaring a session command)
 *
 * ```ts
 * declare const SendInput: Schema<{ readonly content: UserContent; readonly options: SendOptions }>;
 * declare const ReceiptIdSchema: Schema<ReceiptId>;
 *
 * const send = {
 *   input: SendInput,
 *   output: ReceiptIdSchema,
 *   kind: "receipt",
 *   authority: "participant",
 *   scope: "session",
 *   recovery: "replay",
 * } satisfies Declaration<{ readonly content: UserContent; readonly options: SendOptions }, ReceiptId>;
 * ```
 *
 * @see {@link declarations}
 * @category host
 * @since 0.1.0
 */
export type Declaration<Input, Output> = {
  /** The wire record the call takes. */
  readonly input: Schema<Input>;
  /** The wire record the call returns. */
  readonly output: Schema<Output>;
  /**
   * `query` reads once; `watch` yields coalesced views, latest wins;
   * `command` returns its outcome; `receipt` returns a ReceiptId and the
   * outcome is a later query; `stream` yields every frame in order (bytes,
   * scan, search, patches). A `watch` or `stream` that fails after its first
   * frame ends with an error frame carrying the encoded `SdkError` (an
   * `event: error` server-sent event, or a `0x01 { kind: "error", error }`
   * control frame on a framed byte stream), which the client rethrows.
   */
  readonly kind: "query" | "watch" | "command" | "receipt" | "stream";
  /** What the calling principal must hold. */
  readonly authority: Authority;
  /** What the call is addressed to. */
  readonly scope: "host" | "session" | "workspace";
  /** Gated per environment or principal; absent = always. */
  readonly capability?: "files" | "git" | "browser";
  /** Commands only: same id + same digest replays the receipt; volatile actions (pty write, page click) never. */
  readonly recovery?: "replay" | "never";
}

/** The authority and scope of every served operation, keyed by Connection path: the one declaration protocol's table and core's gate both read (§56). */
export const OPERATION_AUTHORITY = {
  "connection.watch": { authority: "participant", scope: "host" },
  "connection.blob": { authority: "participant", scope: "host" },
  "models.list": { authority: "participant", scope: "host" },
  "models.refresh": { authority: "owner", scope: "host" },
  "models.setDefault": { authority: "owner", scope: "host" },
  "models.verify": { authority: "owner", scope: "host" },
  "models.login": { authority: "owner", scope: "host" },
  "models.logout": { authority: "owner", scope: "host" },
  "login.steps": { authority: "owner", scope: "host" },
  "login.answer": { authority: "owner", scope: "host" },
  "settings.apply": { authority: "owner", scope: "host" },
  "workspaces.list": { authority: "participant", scope: "host" },
  "workspaces.inspect": { authority: "owner", scope: "host" },
  "workspaces.add": { authority: "owner", scope: "host" },
  "workspaces.forget": { authority: "owner", scope: "host" },
  "sessions.watch": { authority: "participant", scope: "host" },
  "sessions.create": { authority: "participant", scope: "host" },
  "sessions.list": { authority: "participant", scope: "host" },
  "session.info": { authority: "participant", scope: "session" },
  "session.update": { authority: "participant", scope: "session" },
  "session.remove": { authority: "participant", scope: "session" },
  "session.stop": { authority: "participant", scope: "session" },
  "session.command": { authority: "participant", scope: "session" },
  "head.send": { authority: "participant", scope: "session" },
  "head.configure": { authority: "participant", scope: "session" },
  "head.view": { authority: "participant", scope: "session" },
  "head.watch": { authority: "participant", scope: "session" },
  "head.history": { authority: "participant", scope: "session" },
  "head.tree": { authority: "participant", scope: "session" },
  "head.move": { authority: "participant", scope: "session" },
  "head.compact": { authority: "participant", scope: "session" },
  "heads.create": { authority: "participant", scope: "session" },
  "heads.merge": { authority: "participant", scope: "session" },
  "heads.remove": { authority: "participant", scope: "session" },
  "run.stop": { authority: "participant", scope: "session" },
  "run.settled": { authority: "participant", scope: "session" },
  "receipt.status": { authority: "participant", scope: "session" },
  "receipt.settled": { authority: "participant", scope: "session" },
  "receipt.stop": { authority: "participant", scope: "session" },
  "receipt.landed": { authority: "participant", scope: "session" },
  "parts.create": { authority: "participant", scope: "session" },
  "part.update": { authority: "participant", scope: "session" },
  "part.act": { authority: "participant", scope: "session" },
  "part.answer": { authority: "participant", scope: "session" },
  "part.close": { authority: "participant", scope: "session" },
  "workspace.info": { authority: "participant", scope: "workspace" },
  "workspace.watch": { authority: "participant", scope: "workspace" },
  "workspace.update": { authority: "owner", scope: "workspace" },
  "workspace.reload": { authority: "owner", scope: "workspace" },
  "workspace.changes": { authority: "participant", scope: "workspace" },
  "workspace.patches": { authority: "participant", scope: "workspace" },
  "workspace.files": { authority: "participant", scope: "workspace" },
  "workspace.git": { authority: "participant", scope: "workspace" },
  "workspace.browser": { authority: "participant", scope: "workspace" },
  "jobs.start": { authority: "participant", scope: "workspace" },
  "jobs.recover": { authority: "participant", scope: "workspace" },
  "jobs.list": { authority: "participant", scope: "workspace" },
  "jobs.watch": { authority: "participant", scope: "workspace" },
  "job.write": { authority: "participant", scope: "workspace" },
  "job.output": { authority: "participant", scope: "workspace" },
  "job.resize": { authority: "participant", scope: "workspace" },
  "job.idle": { authority: "participant", scope: "workspace" },
  "job.stop": { authority: "participant", scope: "workspace" },
  "job.settled": { authority: "participant", scope: "workspace" },
  "files.read": { authority: "participant", scope: "workspace" },
  "files.bytes": { authority: "participant", scope: "workspace" },
  "files.stat": { authority: "participant", scope: "workspace" },
  "files.write": { authority: "participant", scope: "workspace" },
  "files.remove": { authority: "participant", scope: "workspace" },
  "files.batch": { authority: "participant", scope: "workspace" },
  "files.format": { authority: "participant", scope: "workspace" },
  "files.scan": { authority: "participant", scope: "workspace" },
  "files.find": { authority: "participant", scope: "workspace" },
  "files.search": { authority: "participant", scope: "workspace" },
  "files.watch": { authority: "participant", scope: "workspace" },
  "files.upload": { authority: "participant", scope: "workspace" },
  "git.status": { authority: "participant", scope: "workspace" },
  "git.watch": { authority: "participant", scope: "workspace" },
  "git.changes": { authority: "participant", scope: "workspace" },
  "git.watchChanges": { authority: "participant", scope: "workspace" },
  "git.patches": { authority: "participant", scope: "workspace" },
  "git.contents": { authority: "participant", scope: "workspace" },
  "git.log": { authority: "participant", scope: "workspace" },
  "git.refs": { authority: "participant", scope: "workspace" },
  "git.blame": { authority: "participant", scope: "workspace" },
  "git.stage": { authority: "owner", scope: "workspace" },
  "git.unstage": { authority: "owner", scope: "workspace" },
  "git.discard": { authority: "owner", scope: "workspace" },
  "git.commit": { authority: "owner", scope: "workspace" },
  "git.branch": { authority: "owner", scope: "workspace" },
  "git.push": { authority: "owner", scope: "workspace" },
  "browser.open": { authority: "participant", scope: "workspace" },
  "browser.adopt": { authority: "participant", scope: "workspace" },
  "browser.list": { authority: "participant", scope: "workspace" },
  "browser.watch": { authority: "participant", scope: "workspace" },
  "page.view": { authority: "participant", scope: "workspace" },
  "page.watch": { authority: "participant", scope: "workspace" },
  "page.snapshot": { authority: "participant", scope: "workspace" },
  "page.navigate": { authority: "participant", scope: "workspace" },
  "page.back": { authority: "participant", scope: "workspace" },
  "page.forward": { authority: "participant", scope: "workspace" },
  "page.reload": { authority: "participant", scope: "workspace" },
  "page.stopLoading": { authority: "participant", scope: "workspace" },
  "page.click": { authority: "participant", scope: "workspace" },
  "page.type": { authority: "participant", scope: "workspace" },
  "page.press": { authority: "participant", scope: "workspace" },
  "page.scroll": { authority: "participant", scope: "workspace" },
  "page.wait": { authority: "participant", scope: "workspace" },
  "page.console": { authority: "participant", scope: "workspace" },
  "page.capture": { authority: "participant", scope: "workspace" },
  "page.evaluate": { authority: "participant", scope: "workspace" },
  "page.close": { authority: "participant", scope: "workspace" },
  "plugins.replace": { authority: "maintenance", scope: "host" },
  "plugins.check": { authority: "maintenance", scope: "host" },
  "principals.list": { authority: "maintenance", scope: "host" },
  "principals.pair": { authority: "maintenance", scope: "host" },
  "principals.revoke": { authority: "maintenance", scope: "host" },
} as const satisfies Readonly<
  Record<string, Pick<Declaration<unknown, unknown>, "authority" | "scope">>
>;

/** Names one served operation. */
export type ServedOperation = keyof typeof OPERATION_AUTHORITY;
