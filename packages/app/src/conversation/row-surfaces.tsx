import { intent } from "@nyte-ai/ui/surface-theme";
import { Marker, MarkerContent } from "@nyte-ai/ui/marker";
import { props } from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";
import { markerStyles } from "./styles.stylex.ts";

export function StatusMarker({
  variant = "default",
  role,
  title,
  children,
}: Pick<ComponentProps<"div">, "role" | "title" | "children"> & {
  readonly variant?: "default" | "destructive" | "retrying";
}): ReactElement {
  return (
    <Marker
      role={role}
      title={title}
      {...props(
        variant === "retrying" ? markerStyles.retrying : markerStyles.default,
        variant === "destructive" && intent.danger,
        variant === "destructive" && markerStyles.destructive,
      )}
    >
      {variant === "retrying" ? (
        <MarkerContent {...props(markerStyles.shimmer)}>{children}</MarkerContent>
      ) : (
        children
      )}
    </Marker>
  );
}
