import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { SandboxHandle } from "@nyte-ai/host/providers";

/** Boots or joins the Vercel Sandbox a `{ kind: "sandbox", locator: { name } }` target names, through `@vercel/sandbox`'s `Sandbox.getOrCreate({ name })` (a target without a string `name` throws `SdkError("invalid")`; a failed boot throws `SdkError("unavailable")` with the SDK's message), and answers its handle: identity the target's content hash (core's `objectId`, what `sandboxProvider`'s default `inspect` answers), `cwd` the sandbox's `cwd`, `files` over the sandbox's file and command calls (paths relative to `cwd`, §41j), `exec` over `runCommand` detached as a pipe job (a pty `unavailable`), `destroy` over `delete()`, and no `git` or `snapshots` seam, so its workspace answers `git` `unsupported` (§42c). */
export async function vercelSandbox(target: WorkspaceTarget): Promise<SandboxHandle> {
  throw new Error("not implemented");
}
