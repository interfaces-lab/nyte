import type { Plugin } from "../core.ts";
import { releaseSession } from "./provider.ts";

export { claudeSdkProvider } from "./provider.ts";

/**
 * The plugin beside the `claude-sdk` provider: a session's run ending closes
 * the Claude Code query it left open on tool calls. Register the provider on
 * the host's models with `models.setProvider(claudeSdkProvider())`.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "claude-sdk",
  hooks: {
    run_ended: (_end, { session }) => {
      if (session !== null) releaseSession(session);
    },
  },
} satisfies Plugin;
