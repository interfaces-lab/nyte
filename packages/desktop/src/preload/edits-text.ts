export function editsText(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
