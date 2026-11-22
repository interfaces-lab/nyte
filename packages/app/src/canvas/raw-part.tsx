import { Collapsible } from "@nyte-ai/ui/collapsible";
import { readRawPart } from "@nyte-ai/plugin/client/presentation";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import type { ReactElement } from "react";
import { Prose } from "../markdown/prose.tsx";
import { disclosureStyles } from "./disclosure.stylex.ts";

export function RawPartView({ message }: { readonly message: PartMessage }): ReactElement {
  const raw = readRawPart(message);

  return (
    <Collapsible.Root xstyle={disclosureStyles.root}>
      <Collapsible.Trigger xstyle={disclosureStyles.toggle}>
        Unsupported {message.partKind} part
        <Collapsible.Chevron />
      </Collapsible.Trigger>
      <Collapsible.Panel xstyle={disclosureStyles.body}>
        <Prose markdown={raw.format === "text" ? raw.body : `\`\`\`json\n${raw.body}\n\`\`\``} />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
