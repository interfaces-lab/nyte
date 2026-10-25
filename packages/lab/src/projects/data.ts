import { useQuery } from "@tanstack/react-query";
import { Value } from "typebox/value";
import { EvidenceType } from "./evidence.ts";
import type { Evidence } from "./evidence.ts";

export const EXPORT_COMMAND =
  "node packages/lab/src/projects/export.ts && node packages/lab/src/projects/checks.ts";

async function readEvidence(): Promise<Evidence> {
  const response = await fetch("/projects-export/evidence.json");

  if (!response.ok) throw new Error(await response.text());
  const value: unknown = await response.json();

  if (!Value.Check(EvidenceType, value))
    throw new Error("evidence.json does not match this page; run the export again.");

  return value;
}

export function useEvidence() {
  return useQuery({
    queryKey: ["projects-export", "evidence"],
    queryFn: readEvidence,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
