import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { useDials } from "../shell/dials.ts";
import type { DialConfig } from "../shell/dials.ts";
import { useScheme } from "../shell/scheme.ts";
import { GuidedReview } from "./GuidedReview";
import type { Take } from "./GuidedReview";
import "./look.css";

const DIALS = {
  story: {
    type: "select",
    options: [
      { value: "read", label: "Read and ask" },
      { value: "findings", label: "Send findings" },
      { value: "before", label: "Before a model runs" },
      { value: "moved", label: "Branch moved" },
    ],
    default: "read",
  },
  cut: {
    type: "select",
    options: [
      { value: "stops", label: "Stops · t3code" },
      { value: "groups", label: "Groups · pulls.review" },
      { value: "sections", label: "Sections · Linear" },
      { value: "order", label: "Files in order · lab" },
    ],
    default: "stops",
  },
  reading: {
    type: "select",
    options: [
      { value: "one", label: "One at a time" },
      { value: "all", label: "All on one page" },
    ],
    default: "one",
  },
  placement: {
    type: "select",
    options: [
      { value: "tab", label: "Changes tab" },
      { value: "rail", label: "Beside the diff" },
      { value: "item", label: "From the item page" },
    ],
    default: "tab",
  },
  findings: {
    type: "select",
    options: [
      { value: "tab", label: "Their own tab" },
      { value: "inline", label: "On each piece" },
      { value: "off", label: "Off" },
    ],
    default: "tab",
  },
  replay: { type: "action", label: "Replay" },
} satisfies DialConfig;

const styles = create({
  page: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 0,
    padding: space.s6,
  },
});

function pick<T extends string>(options: readonly [T, ...T[]], value: string): T {
  return options.find((option) => option === value) ?? options[0];
}

export function ReviewPage(): ReactElement {
  const scheme = useScheme();
  const [run, setRun] = useState(0);

  const dials = useDials("Guided review", DIALS, (action) => {
    if (action === "replay") setRun((count) => count + 1);
  });

  const take: Take = {
    story: pick(["read", "findings", "before", "moved"], dials.story),
    cut: pick(["stops", "groups", "sections", "order"], dials.cut),
    reading: pick(["one", "all"], dials.reading),
    placement: pick(["tab", "rail", "item"], dials.placement),
    findings: pick(["tab", "inline", "off"], dials.findings),
  };

  const key = [run, take.story, take.cut, take.reading, take.placement, take.findings].join(":");

  return (
    <div {...props(styles.page)}>
      <GuidedReview key={key} take={take} theme={scheme} />
    </div>
  );
}
