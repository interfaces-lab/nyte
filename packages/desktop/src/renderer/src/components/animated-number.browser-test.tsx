import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../theme/tokens.css";
import { AnimatedNumber } from "./animated-number.tsx";

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function element(id: string) {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing ${id}`);
  return node;
}

export async function run(reduced: boolean) {
  check(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches === reduced,
    "Media emulation",
  );
  const container = document.createElement("div");
  container.style.font = "13px Arial";
  document.body.append(container);
  const root = createRoot(container);
  const render = (value: number, scope = "file-a") =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <span id="count" style={{ color: "var(--nyte-text-success)" }}>
            +{value > 0 && <AnimatedNumber key={scope} value={value} />}
          </span>
          <span id="filename">example.ts</span>
          <span id="reference" style={{ fontVariantNumeric: "tabular-nums" }}>
            +{value}
          </span>
        </StrictMode>,
      ),
    );
  const accessibleText = () => {
    const copy = element("count").cloneNode(true);
    if (!(copy instanceof HTMLElement)) throw new Error("Expected count element");
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent;
  };
  const checkGeometry = () => {
    const count = element("count").getBoundingClientRect();
    const reference = element("reference").getBoundingClientRect();
    check(
      Math.abs(count.width - reference.width) < 0.1 &&
        Math.abs(count.height - reference.height) < 0.1,
      "Layout must use the current formatted value, not the animated size",
    );
  };
  try {
    render(99);
    check(document.getAnimations().length === 0, "Mount must not animate");
    check(accessibleText() === "+99", "Read the value once on mount");
    checkGeometry();
    const sign = element("count").firstChild;
    const color = getComputedStyle(element("count")).color;
    render(1000);
    check(
      accessibleText() === "+1000",
      "Current accessible value must not wait for motion or gain grouping",
    );
    check(element("count").firstChild === sign, "Sign stays outside the morph");
    check(getComputedStyle(element("count")).color === color, "Semantic color remains stable");
    checkGeometry();
    const filenameLeft = element("filename").getBoundingClientRect().left;
    const animations = document.getAnimations();
    check(
      reduced ? animations.length === 0 : animations.length > 0,
      "Only updates with motion enabled animate",
    );
    if (!reduced) {
      const durationToken = getComputedStyle(element("count"))
        .getPropertyValue("--nyte-duration-normal")
        .trim();
      const duration = Number.parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
      const ease = getComputedStyle(element("count")).getPropertyValue("--nyte-easing-out").trim();
      check(
        animations.some(
          (animation) =>
            animation.effect?.getTiming().duration === duration &&
            animation.effect.getTiming().easing === ease,
        ),
        "Use the current CSS timing tokens",
      );
      animations.forEach((animation) => {
        animation.currentTime = duration / 2;
      });
      check(
        element("filename").getBoundingClientRect().left === filenameLeft,
        "Morphing must not move the filename",
      );
    }
    render(7);
    check(accessibleText() === "+7", "Interrupted morph immediately exposes the latest value");
    checkGeometry();
    const filename = element("filename").getBoundingClientRect();
    check(
      document.elementFromPoint(filename.left + 1, filename.top + filename.height / 2) ===
        element("filename"),
      "The shrinking morph overlay must not cover the filename",
    );
    document.getAnimations().forEach((animation) => animation.cancel());
    check(accessibleText() === "+7", "Cancellation cannot roll back the value");
    render(8);
    const interrupted = document.getAnimations();
    render(12, "file-b");
    check(
      interrupted.every((animation) => animation.playState === "idle"),
      "Changing identity cancels the previous count's animations",
    );
    check(document.getAnimations().length === 0, "Changing identity must not morph between files");
    check(accessibleText() === "+12", "New scope starts at its own count");
    render(0);
    check(accessibleText() === "+", "Callers can hide zero counts immediately");
    render(5000);
    check(
      document.getAnimations().length === 0,
      "Remounting history or a virtualized count must not animate",
    );
    render(5001);
    const active = document.getAnimations();
    flushSync(() => root.unmount());
    check(
      active.every((animation) => animation.playState === "idle"),
      "Unmount cancels descendant animations",
    );
    check(container.textContent === "", "Unmount releases the rendered count");
    return "passed";
  } finally {
    if (container.hasChildNodes()) flushSync(() => root.unmount());
    container.remove();
  }
}
