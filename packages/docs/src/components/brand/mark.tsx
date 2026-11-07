import type { ComponentProps } from "react";

interface WordmarkProps extends ComponentProps<"span"> {
  size?: number;
}

export function NyteWordmark({ size = 18, className, style, ...props }: WordmarkProps) {
  return (
    <span
      className={`inline-flex items-center text-current ${className ?? ""}`}
      style={style}
      {...props}
    >
      <span
        style={{
          fontSize: size,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 1,
        }}
      >
        Nyte
      </span>
    </span>
  );
}
