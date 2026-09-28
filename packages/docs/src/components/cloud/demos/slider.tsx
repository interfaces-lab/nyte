"use client";

import { Slider } from "@nyte-ai/ui/slider";

export function SliderDemo() {
  return (
    <Slider.Root defaultValue={40} thumbAlignment="edge" className="flex w-60 flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <Slider.Label>Intensity</Slider.Label>
        <Slider.Value />
      </div>
      <Slider.Control>
        <Slider.Track>
          <Slider.Indicator />
          <Slider.Thumb />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
