import { createBroker } from "./broker.ts";
import { consoleLogger } from "./log.ts";

export { EnvironmentRelay } from "./relay-object.ts";

export default createBroker({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  log: consoleLogger,
});
