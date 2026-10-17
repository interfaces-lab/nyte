import { useCallback, useRef, useState } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { GlassSurface } from "./composer-glass.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

export type AttachmentFrame = { x: number; y: number; width: number; height: number };

export const AttachmentGlass = Animated.createAnimatedComponent(GlassSurface);

const EMPTY_FRAME: AttachmentFrame = { x: 0, y: 0, width: 0, height: 0 };

const DISSOLVE_MS = 520;

const HOLD_MS = 200;

const TRAVEL = { duration: 640, easing: Easing.out(Easing.cubic) };

export function useAttachmentFlight({
  close,
  cardDock,
  cardHeight,
  windowHeight,
  cardLeft,
}: {
  close: () => void;
  cardDock: SharedValue<number>;
  cardHeight: SharedValue<number>;
  windowHeight: number;
  cardLeft: number;
}) {
  const [pendingId, setPendingId] = useState<string>();
  const [revealedId, setRevealedId] = useState<string>();
  const [photo, setPhoto] = useState<{ id: string; uri: string }>();
  const [surfaceHidden, setSurfaceHidden] = useState(false);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const source = useSharedValue(EMPTY_FRAME);
  const targetLayout = useSharedValue(EMPTY_FRAME);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const generation = useRef(0);
  const activeId = useRef<string | undefined>(undefined);

  useMountEffect(() => () => {
    generation.current += 1;
    activeId.current = undefined;

    for (const timer of timers.current) clearTimeout(timer);
  });

  const reportFrame = useCallback(
    (id: string, frame: AttachmentFrame) => {
      if (activeId.current === id && frame.width > 0 && frame.height > 0) targetLayout.set(frame);
    },
    [targetLayout],
  );

  const run = (next: { id: string; uri: string }, commit: () => void, frame: AttachmentFrame) => {
    generation.current += 1;
    const current = generation.current;
    activeId.current = next.id;
    source.set(frame);
    targetLayout.set(EMPTY_FRAME);
    progress.set(0);
    opacity.set(0);
    setSurfaceHidden(false);
    setPhoto(next);
    setPendingId(next.id);
    opacity.set(withTiming(1, { duration: DISSOLVE_MS }));
    requestAnimationFrame(() => {
      if (generation.current === current) commit();
    });
    timers.current.add(
      setTimeout(() => {
        if (generation.current === current) setSurfaceHidden(true);
      }, DISSOLVE_MS),
    );
    progress.set(withDelay(DISSOLVE_MS + HOLD_MS, withTiming(1, TRAVEL)));
    timers.current.add(
      setTimeout(
        () => {
          if (generation.current !== current) return;
          setRevealedId(next.id);
          timers.current.add(
            setTimeout(() => {
              if (generation.current !== current) return;
              activeId.current = undefined;
              setPhoto(undefined);
              setPendingId(undefined);
              setRevealedId(undefined);
              close();
            }, 80),
          );
        },
        DISSOLVE_MS + HOLD_MS + TRAVEL.duration + 40,
      ),
    );
  };

  const overlayStyle = useAnimatedStyle(() => {
    const from = source.get();
    const local = targetLayout.get();
    const ready = local.width > 0 && cardHeight.get() > 0;
    const x = ready ? cardLeft + local.x : from.x;
    const y = ready ? windowHeight - cardDock.get() - cardHeight.get() + local.y : from.y;
    const width = ready ? local.width : from.width;
    const height = ready ? local.height : from.height;
    const amount = progress.get();

    return {
      left: from.x + (x - from.x) * amount,
      top: from.y + (y - from.y) * amount,
      width: from.width + (width - from.width) * amount,
      height: from.height + (height - from.height) * amount,
      borderRadius: 35 + (14 - 35) * amount,
      opacity: opacity.get(),
    };
  });

  const reset = () => {
    generation.current += 1;
    activeId.current = undefined;

    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    progress.set(0);
    opacity.set(0);
    targetLayout.set(EMPTY_FRAME);
    setRevealedId(pendingId);
    setPendingId(undefined);
    setPhoto(undefined);
    setSurfaceHidden(false);
  };

  return { pendingId, revealedId, photo, surfaceHidden, overlayStyle, reportFrame, run, reset };
}

export type AttachmentFlight = ReturnType<typeof useAttachmentFlight>;
