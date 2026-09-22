/**
 * The pairing code the iOS app scans. The matrix is drawn as one SVG path so it
 * stays crisp at any size and takes its color from the theme instead of a
 * baked-in bitmap. The payload is the same `nyte://connect` string a person can
 * paste, so scanning and pasting cannot drift apart.
 */
import * as stylex from "@stylexjs/stylex";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import type { ReactElement } from "react";
import { t } from "../theme/vars.stylex.ts";

const styles = stylex.create({
  frame: {
    display: "grid",
    placeItems: "center",
    padding: 10,
    borderRadius: t.radiusLg,
    backgroundColor: "#ffffff",
  },
  code: { display: "block", shapeRendering: "crispEdges" },
});

export function pairingPayload(input: { address: string; token: string }): string {
  const query = new URLSearchParams({ url: input.address, token: input.token });

  return `nyte://connect?${query.toString()}`;
}

/** Every dark module as one path, drawn in a single fill. */
function modulePath(code: ReturnType<typeof qrcode>): string {
  const count = code.getModuleCount();
  let path = "";

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) path += `M${String(column)} ${String(row)}h1v1h-1z`;
    }
  }

  return path;
}

export function PairingCode({ value, size }: { value: string; size: number }): ReactElement {
  const { path, count } = useMemo(() => {
    // Type 0 picks the smallest version that fits; M corrects ~15% of the area,
    // which is what a screen-to-camera scan needs.
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();

    return { path: modulePath(code), count: code.getModuleCount() };
  }, [value]);

  return (
    <div {...stylex.props(styles.frame)}>
      <svg
        role="img"
        aria-label="Pairing code for the Nyte iOS app"
        width={size}
        height={size}
        viewBox={`0 0 ${String(count)} ${String(count)}`}
        {...stylex.props(styles.code)}
      >
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
