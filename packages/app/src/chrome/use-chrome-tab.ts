import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ShellSearch } from "../router.tsx";

export function useChromeTab<Value extends string>(
  key: keyof ShellSearch,
  options: readonly [Value, ...Value[]],
): readonly [Value, (value: Value) => void] {
  const candidate = useSearch({ from: "__root__", select: (search) => search[key] });
  const navigate = useNavigate();
  const value = options.find((option) => option === candidate) ?? options[0];

  return [
    value,
    (next) => {
      void navigate({ to: ".", search: (previous) => ({ ...previous, [key]: next }) });
    },
  ];
}
