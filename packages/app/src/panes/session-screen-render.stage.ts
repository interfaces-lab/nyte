interface Scene {
  step: string;
  readonly failures: string[];
  renderFailure: unknown;
}

export const scene: Scene = { step: "mount", failures: [], renderFailure: undefined };

export async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (!predicate()) {
    if (scene.renderFailure !== undefined) throw scene.renderFailure;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

export function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

export function expectRule(rule: string, condition: boolean, detail: string): void {
  const line = `rule ${rule} (${scene.step}): ${detail}`;

  if (!condition && !scene.failures.includes(line)) scene.failures.push(line);
}

export interface Stage {
  readonly viewport: HTMLElement;
  readonly log: HTMLElement;
  readonly dock: HTMLElement;
}

let stage: Stage;

export const PROSE = "p:not([data-sticky-user-message] *)";

export function measureTop(element: Element): number {
  return Math.round(
    element.getBoundingClientRect().top - stage.viewport.getBoundingClientRect().top,
  );
}

export function listRows(): HTMLElement[] {
  return Array.from(stage.log.querySelectorAll<HTMLElement>("[data-row-key]")).sort(
    (first, second) => Number(first.dataset.index) - Number(second.dataset.index),
  );
}

export function visible(selector: string): HTMLElement[] {
  const bottom = measureTop(stage.dock);

  return Array.from(stage.log.querySelectorAll<HTMLElement>(selector))
    .filter((block) => {
      const height = block.getBoundingClientRect().height;

      return height > 0 && measureTop(block) >= 0 && measureTop(block) + height <= bottom;
    })
    .sort((first, second) => measureTop(first) - measureTop(second));
}

export function answerIndex(row: HTMLElement): number | undefined {
  const match = /^response:answer-(\d+)$/u.exec(row.dataset.rowKey ?? "");

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function distance(): number {
  return stage.viewport.scrollHeight - stage.viewport.clientHeight - stage.viewport.scrollTop;
}

export function buttonShown(): boolean {
  const button = stage.dock.querySelector("[data-slot='scroll-to-bottom']");

  return button !== null && getComputedStyle(button).visibility === "visible";
}

export function checkFrame(label: string): void {
  const rows = listRows();

  for (const [index, below] of rows.entries()) {
    const above = rows[index - 1];

    const overlap =
      above === undefined
        ? 0
        : above.getBoundingClientRect().bottom - below.getBoundingClientRect().top;

    expectRule("22", overlap <= 0.5, `${label}: rows overlap by ${overlap.toFixed(1)}px`);
  }

  const stuck = stage.log.querySelectorAll("[data-sticky-active='true']").length;
  expectRule("17", stuck <= 1, `${label}: ${String(stuck)} prompts are stuck at once`);
  const last = rows.at(-1);

  const extent =
    last === undefined
      ? 0
      : stage.log.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;

  expectRule(
    "23",
    extent >= -0.5,
    `${label}: extent ends ${(-extent).toFixed(1)}px above the last row`,
  );

  const column =
    stage.viewport.getBoundingClientRect().bottom - stage.dock.getBoundingClientRect().bottom;

  expectRule(
    "13",
    Math.abs(column) <= 1,
    `${label}: composer sits ${column.toFixed(1)}px above the column's bottom`,
  );

  const viewport = getComputedStyle(stage.viewport);
  const masked = Number.parseFloat(viewport.getPropertyValue("--_dock-height"));

  const dockTop =
    stage.viewport.getBoundingClientRect().bottom - stage.dock.getBoundingClientRect().top;

  expectRule(
    "13",
    viewport.maskImage.startsWith("linear-gradient") && Math.abs(masked - dockTop) <= 1,
    `${label}: the transcript is masked ${String(masked)}px above the bottom, the composer's top is ${dockTop.toFixed(1)}px`,
  );
  expectRule(
    "25",
    buttonShown() === distance() > 60,
    `${label}: button shown=${String(buttonShown())} at ${distance().toFixed(0)}px from the end`,
  );
}

export function checkFollowing(label: string): void {
  checkFrame(label);
  expectRule(
    "1-4",
    Math.abs(distance()) <= 1,
    `${label}: ${distance().toFixed(1)}px from the end while following`,
  );
  const last = listRows().at(-1);

  const gap =
    last === undefined
      ? 0
      : stage.dock.getBoundingClientRect().top - last.getBoundingClientRect().bottom;

  const room = stage.viewport.clientHeight - stage.dock.offsetHeight;
  expectRule(
    "14",
    Math.abs(gap - Math.min(114, 2 * Math.floor((room * 0.17) / 2))) <= 1,
    `${label}: last row ends ${gap.toFixed(1)}px above the composer`,
  );
}

export async function frames(label: string, verify: () => void): Promise<void> {
  for (let frame = 0; frame < 4; frame += 1) {
    await painted();
    checkFrame(`${label} frame ${String(frame)}`);
    verify();
  }
}

export async function wheel(delta: number): Promise<void> {
  stage.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
  stage.viewport.scrollTop += delta;
  await painted();
}

export async function wheelUntil(found: () => boolean, delta = -300, limit = 60): Promise<void> {
  for (let count = 0; count < limit && !found(); count += 1) await wheel(delta);
}

export async function toEnd(): Promise<void> {
  stage.dock.querySelector<HTMLButtonElement>("button[aria-label='Scroll to bottom']")?.click();
  await painted();
}

export async function openEditor(row: HTMLElement): Promise<void> {
  row.querySelector<HTMLElement>("[data-composer-readonly]")?.click();
  await until(() => row.querySelector("[contenteditable='true']") !== null, "the editor");
  await painted();
}

export async function firstPaintedRows(container: HTMLElement): Promise<Stage> {
  await until(() => container.querySelector("[data-composer-region]") !== null, "the composer");

  for (;;) {
    await painted();
    const viewport = container.querySelector<HTMLElement>("[aria-label='Messages']");
    const log = container.querySelector<HTMLElement>("[aria-label='Messages'] > div");
    const dock = container.querySelector<HTMLElement>("[data-composer-region]")?.parentElement;

    if (
      viewport &&
      log &&
      dock &&
      log.querySelector("[data-row-key]:not([data-row-key='row:skeleton'])")
    ) {
      stage = { viewport, log, dock };

      return stage;
    }
  }
}

export async function type(text: string): Promise<void> {
  const draft = stage.dock.querySelector<HTMLElement>("[aria-multiline][aria-label='Message']");

  if (draft === null) throw new Error("The composer has no editor");
  draft.focus();
  window.getSelection()?.collapse(draft, draft.childNodes.length);
  await painted();
  document.execCommand("insertText", false, text);
  await painted();
}

export const near = (value: number, target: number): boolean => Math.abs(value - target) <= 1;

export const moved = (element: Element, top: number): string =>
  `moved from ${String(top)} to ${String(measureTop(element))}`;

export function first<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null)
    throw new Error(`${what} is missing at ${scene.step}\n${scene.failures.join("\n")}`);

  return value;
}
