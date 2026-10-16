import { getRouteApi } from "@tanstack/react-router";

const site = getRouteApi("/_site");
const landing = getRouteApi("/_site/_landing");

/** The latest Mac release, loaded once for every page under the site nav. */
export function useMacRelease() {
  return site.useLoaderData({ select: (data) => data.release });
}

/** The landing preview's highlighted diff, loaded by the landing layout. */
export function useEditDiff() {
  return landing.useLoaderData({ select: (data) => data.editDiff });
}
