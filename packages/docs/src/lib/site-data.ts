import { getRouteApi } from "@tanstack/react-router";

const site = getRouteApi("/_site");

/** The latest Mac release, loaded once for every page under the site nav. */
export function useMacRelease() {
  return site.useLoaderData({ select: (data) => data.release });
}
