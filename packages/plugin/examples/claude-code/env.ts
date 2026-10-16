export function envFlagEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return !!normalized && !["0", "false", "no", "off"].includes(normalized);
}
