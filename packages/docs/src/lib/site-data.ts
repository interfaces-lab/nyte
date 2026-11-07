import { getRouteApi } from "@tanstack/react-router";

const site = getRouteApi("/_site");

export function useMacRelease() {
  return site.useLoaderData({ select: (data) => data.release });
}
