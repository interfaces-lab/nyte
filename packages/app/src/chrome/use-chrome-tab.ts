import { useNavigate, useRouterState } from "@tanstack/react-router";

export function useChromeTab<Value extends string>(
  key: string,
  options: readonly [Value, ...Value[]],
): readonly [Value, (value: Value) => void] {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const navigate = useNavigate();
  const candidate = new URLSearchParams(search).get(key);
  const value = options.find((option) => option === candidate) ?? options[0];

  return [
    value,
    (next) => {
      void navigate({ to: ".", search: (previous) => ({ ...previous, [key]: next }) });
    },
  ];
}
