import { Kbd } from "@nyte-ai/ui/kbd";
import { create, props } from "@stylexjs/stylex";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/*
 * Each override sorts before the component's own declaration for that
 * property, where one StyleX pass used to let the component win.
 */
const styles = create({
  override: { paddingInline: 10, color: "rgb(255, 0, 0)" },
  xstyle: { fontWeight: 700 },
});

export function run() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    flushSync(() =>
      root.render(
        <Kbd
          keys={["K"]}
          className={props(styles.override).className}
          style={{ letterSpacing: "3px" }}
          xstyle={styles.xstyle}
        />,
      ),
    );
    const kbd = container.querySelector("kbd");

    if (kbd === null) throw new Error("Kbd did not render");
    const computed = getComputedStyle(kbd);

    const actual = {
      className: [computed.paddingInlineStart, computed.color],
      style: computed.letterSpacing,
      xstyle: computed.fontWeight,
    };

    const expected = {
      className: ["10px", "rgb(255, 0, 0)"],
      style: "3px",
      xstyle: "700",
    };

    return JSON.stringify(actual) === JSON.stringify(expected) ? "passed" : JSON.stringify(actual);
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
