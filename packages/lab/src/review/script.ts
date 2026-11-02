import type { Act } from "../../.local/stageshow-kit";
import { EMPTY_PATH, FIRST_GUIDE, WRITING_STEPS } from "./data";
import { askAt, emptyIndex, question, type Head, type S, type Take } from "./model";
import { units } from "./units";

export const REST = { at: "rest", x: 0.94, y: 0.5 };

export function opening(take: Take): S {
  const base: S = {
    screen: take.placement === "item" ? "item" : "review",
    view: "guide",
    phase: take.story === "before" ? "sorted" : "ready",
    step: 0,
    arrived: take.story === "before" ? 0 : 99,
    head: "first",
    guideHead: "first",
    rewriting: false,
    current: 0,
    viewed: {},
    asking: false,
    typed: "",
    asked: false,
    dropped: [],
    sending: "idle",
  };

  if (take.story !== "moved") return base;

  const upTo = emptyIndex(take);

  const marked = units(take.cut, FIRST_GUIDE)
    .slice(0, upTo + 1)
    .flatMap((unit) => unit.files)
    .map((file): [string, Head] => [file.path, "first"]);

  return {
    ...base,
    viewed: Object.fromEntries(marked),
    current: take.reading === "one" ? upTo : 0,
  };
}

export function poster(take: Take): S {
  const start = { ...opening(take), screen: "review" as const };
  const at = emptyIndex(take);
  const first = units(take.cut, FIRST_GUIDE)[0];

  const firstMarks = Object.fromEntries(
    (first?.files ?? []).map((file): [string, Head] => [file.path, "first"]),
  );

  if (take.story === "read")
    return {
      ...start,
      viewed: firstMarks,
      current: askAt(take),
      asked: true,
      typed: question(take),
    };

  if (take.story === "findings" && take.findings !== "off")
    return {
      ...start,
      view: take.findings === "tab" ? "findings" : "guide",
      current: take.findings === "inline" && take.reading === "one" ? at : 0,
      dropped: ["button-noun"],
      sending: "sent",
    };

  if (take.story === "before") return { ...start, phase: "ready", arrived: 99 };

  if (take.story === "moved")
    return {
      ...start,
      head: "second",
      guideHead: "second",
      viewed: { ...start.viewed, [EMPTY_PATH]: "second" },
    };

  return start;
}

export function script(take: Take) {
  return async (a: Act<S>): Promise<void> => {
    await a.wait(900);

    if (take.placement === "item") {
      a.mark("open");
      await a.click({ at: "open-guide", x: 0.8, y: 0.6 });
      await a.set({ screen: "review" });
      await a.move(REST);
      await a.wait(700);
    }

    if (take.story === "before") return before(a, take);

    if (take.story === "moved") return moved(a);

    if (take.story === "findings" && take.findings !== "off") return findings(a, take);

    return read(a, take);
  };
}

async function goTo(a: Act<S>, take: Take, index: number): Promise<void> {
  if (take.reading === "one") {
    await a.key("j");
    await a.set({ current: index });

    return;
  }

  await a.scroll("guide", `unit-${String(index)}`);
  await a.set({ current: index });
}

async function view(a: Act<S>, path: string, head: Head): Promise<void> {
  await a.click({ at: `view:${path}`, x: 0.3, y: 0.5 });
  await a.set((s) => ({ viewed: { ...s.viewed, [path]: head } }));
}

async function read(a: Act<S>, take: Take): Promise<void> {
  const first = units(take.cut, FIRST_GUIDE)[0]?.files[0];

  a.mark("view");

  if (first !== undefined) await view(a, first.path, "first");
  await a.wait(600);

  if (take.reading === "one") {
    a.mark("next");
    await goTo(a, take, emptyIndex(take));
    await a.wait(700);
  }

  a.mark("ask");
  await a.click({ at: "ask", x: 0.8, y: 0.6 });
  await a.set({ asking: true });
  await a.wait(250);
  await a.type("typed", question(take), { interval: 28 });
  await a.wait(300);
  await a.click({ at: "send-ask", x: 0.5, y: 0.5 });
  await a.set({ asking: false, asked: true });
  await a.move(REST);
  await a.wait(2400);
}

async function findings(a: Act<S>, take: Take): Promise<void> {
  a.mark("open-findings");

  if (take.findings === "tab") {
    await a.click({ at: "tab-findings", x: 0.7, y: 0.5 });
    await a.set({ view: "findings" });
  } else {
    await goTo(a, take, emptyIndex(take));
  }

  await a.wait(700);

  a.mark("drop");
  await a.click({ at: "keep:button-noun", x: 0.5, y: 0.5 });
  await a.set((s) => ({ dropped: [...s.dropped, "button-noun"] }));
  await a.wait(700);

  a.mark("send");
  await a.click({ at: "send-findings", x: 0.82, y: 0.6 });
  await a.set({ sending: "sending" });
  await a.wait(1100);
  await a.set({ sending: "sent" });
  await a.move(REST);
  await a.wait(2400);
}

async function before(a: Act<S>, take: Take): Promise<void> {
  a.mark("write");
  await a.click({ at: "write-guide", x: 0.82, y: 0.6 });
  await a.set({ phase: "writing" });
  await a.move(REST);

  for (const index of WRITING_STEPS.keys()) {
    await a.set({ step: index });
    await a.wait(560);
  }

  a.mark("arrive");
  await a.set({ phase: "ready", arrived: 0 });
  await a.stagger(
    units(take.cut, FIRST_GUIDE).map((_, index) => index),
    (index) => a.set({ arrived: index + 1 }),
    140,
  );
  await a.wait(2600);
}

async function moved(a: Act<S>): Promise<void> {
  await a.wait(300);

  a.mark("push");
  await a.set({ head: "second" });
  await a.wait(1500);

  a.mark("rewrite");
  await a.click({ at: "rewrite", x: 0.82, y: 0.6 });
  await a.set({ rewriting: true });
  await a.wait(1700);
  await a.set({ guideHead: "second", rewriting: false });
  await a.wait(900);

  a.mark("review-again");
  await view(a, EMPTY_PATH, "second");
  await a.move(REST);
  await a.wait(2400);
}
