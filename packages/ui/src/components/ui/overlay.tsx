/**
 * A host that paints something above the DOM, such as a native view, needs to
 * know which floating surfaces are open so it can step aside. Every popup and
 * backdrop in this package attaches the provided ref callback; without a
 * provider nothing is attached.
 */
import { createContext, use, type ReactElement, type ReactNode } from "react";

/** A React 19 ref callback: called with the mounted element, returns its cleanup. */
export type OverlayRef = (element: Element | null) => (() => void) | undefined;

const OverlayRefContext = createContext<OverlayRef | undefined>(undefined);

export interface OverlayRefProviderProps {
  readonly value: OverlayRef;
  readonly children: ReactNode;
}

export function OverlayRefProvider({ value, children }: OverlayRefProviderProps): ReactElement {
  return <OverlayRefContext value={value}>{children}</OverlayRefContext>;
}

/** Pass the result as `ref` on a popup, positioner-less panel, or backdrop. */
export function useOverlayRef(): OverlayRef | undefined {
  return use(OverlayRefContext);
}
