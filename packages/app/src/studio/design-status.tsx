import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { errorMessage } from "../contract/errors.ts";
import { viewerStyles } from "../workbench/editor/file-viewers.tsx";
import type { DesignStore, DesignTrouble } from "./designs.ts";

export function DesignStatus(input: { readonly store: DesignStore }): ReactElement | null {
  const troubles = input.store.useTroubles();

  if (troubles.length === 0) return null;

  return (
    <div>
      {troubles.map((trouble) => (
        <TroubleRow key={trouble.path} store={input.store} trouble={trouble} />
      ))}
    </div>
  );
}

function TroubleRow(input: {
  readonly store: DesignStore;
  readonly trouble: DesignTrouble;
}): ReactElement {
  const trouble = input.trouble;
  const store = input.store;
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string>();

  const run = (action: (design: string) => Promise<void>): void => {
    setRunning(true);
    setFailure(undefined);

    void action(trouble.path).then(
      () => setRunning(false),
      (cause: unknown) => {
        setFailure(errorMessage(cause));
        setRunning(false);
      },
    );
  };

  const message =
    failure ??
    (trouble.status.kind === "conflict"
      ? `${trouble.path} changed on disk.`
      : `${trouble.path} wasn't saved: ${trouble.status.message}`);

  return (
    <div {...props(viewerStyles.status, hairline.blockEnd)}>
      <span role="alert" {...props(intent.danger, viewerStyles.statusText)}>
        {message}
      </span>
      {trouble.status.kind === "conflict" ? (
        <>
          <Button
            size="2xs"
            disabled={running}
            onClick={() => run((design) => store.overwrite(design))}
          >
            Overwrite with Mine
          </Button>
          <Button
            size="2xs"
            variant="plain"
            disabled={running}
            onClick={() => run((design) => store.reload(design))}
          >
            Use File on Disk
          </Button>
        </>
      ) : (
        <Button size="2xs" disabled={running} onClick={() => run((design) => store.save(design))}>
          Retry Save
        </Button>
      )}
    </div>
  );
}
