import { GlassButton } from "./glass-button.tsx";

/** Full-width in-content action. SwiftUI glass; prominent for the primary path. */
export function PrimaryButton({
  label,
  onClick,
  disabled = false,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary";
}) {
  return (
    <GlassButton
      label={label}
      onPress={onClick}
      disabled={disabled}
      prominent={tone === "primary"}
      fill
    />
  );
}
