import { cloudSource, source } from "~/lib/source";
import { createSearchAPI } from "fumadocs-core/search/server";

// One index across both collections so a search from /docs can land on a
// Cloud component page and the reverse.
export const { GET } = createSearchAPI("advanced", {
  indexes: async () => {
    const pages = [...source.getPages(), ...cloudSource.getPages()];
    return pages.map((page) => ({
      id: page.url,
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      structuredData: page.data.structuredData,
    }));
  },
});
