import { hostname } from "node:os";
import { NAME_LIMIT } from "../index.ts";

export function machineName(): string {
  const name = (hostname().split(".")[0] ?? "").trim().slice(0, NAME_LIMIT);

  return name === "" ? "Nyte desktop" : name;
}
