// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T takes the argument's non-function members so F infers as its function member; without it callers with a generic union lose the narrowing.
export function callable<T, F extends (...args: never[]) => unknown>(value: T | F): value is F {
  return typeof value === "function";
}
