import { BROWSER_OPERATIONS } from "./browser.ts";
import { FILE_OPERATIONS } from "./files.ts";
import { GIT_OPERATIONS } from "./git.ts";
import { GITHUB_OPERATIONS } from "./github.ts";
import { HOST_OPERATIONS, MAINTENANCE_OPERATIONS } from "./host.ts";
import { SESSION_OPERATIONS } from "./session.ts";
import { WORKSPACE_OPERATIONS } from "./workspace.ts";

/** The operations table, keyed by Connection path: every served operation's wire schemas, kind, authority, scope, capability, recovery and wait, in the order the host lists them. */
export const OPERATIONS = {
  ...HOST_OPERATIONS,
  ...SESSION_OPERATIONS,
  ...WORKSPACE_OPERATIONS,
  ...FILE_OPERATIONS,
  ...GIT_OPERATIONS,
  ...GITHUB_OPERATIONS,
  ...BROWSER_OPERATIONS,
  ...MAINTENANCE_OPERATIONS,
};
