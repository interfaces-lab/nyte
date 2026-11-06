import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Prose } from "../../chat/markdown/prose.tsx";
import { UserMessageView } from "../../chat/transcript/turn-view.tsx";
import { conversation } from "../../theme/schema.stylex.ts";

const QUESTION = "Where do we read the config file?";

const ANSWER = `In \`loadConfig\`. It joins \`NYTE_HOME\` with \`config.json\` and parses it once at startup:

\`\`\`ts
export function loadConfig(home: string): Config {
  return parseConfig(readFileSync(join(home, "config.json"), "utf8"));
}
\`\`\``;

export function TypographyPreview(): ReactElement {
  return (
    <div {...props(styles.turn)}>
      <UserMessageView content={QUESTION} />
      <Prose markdown={ANSWER} />
    </div>
  );
}

const styles = create({
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
  },
});
