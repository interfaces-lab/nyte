import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import type { ReactElement } from "react";

const styles = create({
  frame: {
    display: "grid",
    placeItems: "center",
    padding: space.s2_5,
    borderRadius: radius.control,
    backgroundColor: "#ffffff",
  },
  code: { display: "block", shapeRendering: "crispEdges" },
});

export function pairingPayload(input: { address: string; token: string }): string {
  const query = new URLSearchParams({ url: input.address, token: input.token });

  return `nyte://connect?${query.toString()}`;
}

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
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();

    return { path: modulePath(code), count: code.getModuleCount() };
  }, [value]);

  return (
    <div {...props(styles.frame)}>
      <svg
        role="img"
        aria-label="Pairing code for the Nyte iOS app"
        width={size}
        height={size}
        viewBox={`0 0 ${String(count)} ${String(count)}`}
        {...props(styles.code)}
      >
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
