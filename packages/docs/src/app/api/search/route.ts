import { kernelSource, cloudSource, source } from "~/lib/source";
import { createSearchAPI } from "fumadocs-core/search/server";

export const { GET } = createSearchAPI("advanced", {
  indexes: async () => {
    const pages = [...source.getPages(), ...cloudSource.getPages(), ...kernelSource.getPages()];
    return pages.map((page) => ({
      id: page.url,
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      structuredData: page.data.structuredData,
    }));
  },
});
