import { Composition } from "remotion";
import { compositions } from "./project";

export const Root = () => (
  <>
    {compositions.map((composition) => (
      <Composition
        key={composition.id}
        id={composition.id}
        component={composition.component}
        width={composition.width}
        height={composition.height}
        fps={composition.fps}
        durationInFrames={composition.durationInFrames}
      />
    ))}
  </>
);
