import { Collapsible } from "@nyte-ai/ui/collapsible";
import { readRawPart } from "@nyte-ai/plugin/client/presentation";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import type { ReactElement } from "react";
import { Prose } from "./prose.tsx";
import { turnStyles } from "./turn.stylex.ts";

export function RawPartView({ message }: { readonly message: PartMessage }): ReactElement {
  const raw = readRawPart(message);

  return (
    <Collapsible.Root xstyle={turnStyles.history}>
      <Collapsible.Trigger xstyle={turnStyles.disclosureToggle}>
        Unsupported {message.partKind} part
        <Collapsible.Chevron />
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={turnStyles.historyBody}>
        <Prose markdown={raw.format === "text" ? raw.body : `\`\`\`json\n${raw.body}\n\`\`\``} />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
