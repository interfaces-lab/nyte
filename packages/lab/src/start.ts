import { createStart } from "@tanstack/react-start";

/** Every page reads the lab's stub host bridge, which exists only in a browser. */
export const startInstance = createStart(() => ({ defaultSsr: false }));
