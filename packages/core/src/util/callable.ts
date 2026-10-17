/** Whether `value`, a value or a function deriving one, is the function. */
export function callable<T, F extends (...args: never[]) => unknown>(value: T | F): value is F {
  return typeof value === "function";
}
