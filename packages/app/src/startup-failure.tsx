import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { space } from "@nyte-ai/ui/styles/schema.stylex";

const styles = create({
  failure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    height: "100%",
    overflowWrap: "anywhere",
  },
});

export function StartupFailure({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <main {...props(styles.failure)}>
      <p role="alert">{message}</p>
      <Button onClick={onRetry}>Try Again</Button>
    </main>
  );
}
