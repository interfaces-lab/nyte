"use client";

import { Switch } from "@nyte-ai/ui/switch";
import { useState } from "react";

export function SwitchDemo() {
  const [wrap, setWrap] = useState(true);

  return (
    <>
      <Switch label="Code block word wrap" checked={wrap} onCheckedChange={setWrap} />
      <Switch label="Reduce transparency" disabled />
    </>
  );
}
