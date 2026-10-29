const END_SLACK_PX = 4;

const READER_INPUT_MS = 250;

export interface StepGroupPin {
  readonly pinned: boolean;
  readonly scrollTop: number;
  readonly inputAt: number;
  readonly pointerDown: boolean;
}

export type StepGroupPinEvent =
  | { readonly kind: "input"; readonly at: number }
  | { readonly kind: "pointer"; readonly down: boolean }
  | {
      readonly kind: "scrolled";
      readonly at: number;
      readonly scrollTop: number;
      readonly scrollHeight: number;
      readonly clientHeight: number;
    };

export const PINNED: StepGroupPin = {
  pinned: true,
  scrollTop: 0,
  inputAt: Number.NEGATIVE_INFINITY,
  pointerDown: false,
};

export function nextPin(pin: StepGroupPin, event: StepGroupPinEvent): StepGroupPin {
  switch (event.kind) {
    case "input":
      return { ...pin, inputAt: event.at };
    case "pointer":
      return { ...pin, pointerDown: event.down };
    case "scrolled": {
      const atEnd = event.scrollHeight - event.clientHeight - event.scrollTop <= END_SLACK_PX;
      const byReader = pin.pointerDown || event.at - pin.inputAt <= READER_INPUT_MS;

      return {
        ...pin,
        pinned: atEnd || (pin.pinned && !(byReader && event.scrollTop < pin.scrollTop)),
        scrollTop: event.scrollTop,
      };
    }

    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}
