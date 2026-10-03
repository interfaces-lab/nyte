import { hostname } from "node:os";
import { NAME_LIMIT } from "@nyte-ai/connect";

/** This computer's name as people say it: the host name without its network domain. */
export function machineName(): string {
  const name = (hostname().split(".")[0] ?? "").trim().slice(0, NAME_LIMIT);

  return name === "" ? "Nyte desktop" : name;
}
