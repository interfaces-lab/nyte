import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { BrowserFindResult } from "../bridge.ts";
import { Button } from "@nyte-ai/ui/button";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { nyte } from "../nyte.ts";
import { setBrowserFinding } from "./browser-surfaces.ts";

const styles = create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    paddingBlock: 4,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
  },
  field: { width: 260, maxWidth: "60%" },
  count: {
    minWidth: 64,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});

const NONE: BrowserFindResult = { active: 0, total: 0 };

export function FindBar({ surface }: { readonly surface: string }): ReactElement {
  const [text, setText] = useState("");
  const [result, setResult] = useState<BrowserFindResult>(NONE);

  const find = (query: string, direction: "next" | "previous"): void => {
    const browser = nyte.host.browser;

    if (browser === undefined) return;
    void browser
      .find({ surface, text: query, direction })
      .then(setResult)
      .catch(() => setResult(NONE));
  };

  const close = (): void => {
    find("", "next");
    setBrowserFinding(surface, false);
  };

  return (
    <div role="search" aria-label="Find in page" {...props(styles.bar)}>
      <InputGroup xstyle={styles.field}>
        <Input
          autoFocus
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label="Find in page"
          placeholder="Find in page"
          value={text}
          onValueChange={(value) => {
            setText(value);
            find(value, "next");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              find(text, event.shiftKey ? "previous" : "next");
            }

            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
      </InputGroup>
      <span {...props(styles.count)} aria-live="polite">
        {text === ""
          ? ""
          : result.total === 0
            ? "No matches"
            : `${String(result.active)} of ${String(result.total)}`}
      </span>
      <Button
        iconOnly
        icon="arrow-up"
        size="sm"
        aria-label="Previous match"
        disabled={result.total === 0}
        onClick={() => find(text, "previous")}
      />
      <Button
        iconOnly
        icon="arrow-down"
        size="sm"
        aria-label="Next match"
        disabled={result.total === 0}
        onClick={() => find(text, "next")}
      />
      <Button iconOnly icon="x" size="sm" aria-label="Close find" onClick={close} />
    </div>
  );
}
