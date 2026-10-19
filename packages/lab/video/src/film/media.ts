/**
 * Everything the film shows that it does not draw: the opening gameplay,
 * photographs from the internet, and the real app filmed in a sandbox. None
 * of it is in Git; the README says how to fetch the gameplay and photographs
 * and how to film the app again.
 */

/** Something the film shows, under video/public, at its size in pixels. */
export interface Media {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** A video, played muted from a point in it, rather than a still. */
  readonly video?: boolean;
}

/**
 * The opening footage: Minecraft survival gameplay by Naybr, published under
 * YouTube's Creative Commons Attribution licence, free to use and monetise
 * with the credit below. `clips/naybr.mp4` is 0:30 to 2:30 of the source, at
 * 30 fps and without sound.
 */
export const clip = {
  file: "clips/naybr.mp4",
  width: 1920,
  height: 1080,
  video: true,
  source: "https://www.youtube.com/watch?v=GPsGyv5zTlM",
  credit: "Gameplay – youtube.com/@Naybr",
} as const satisfies Media & { readonly source: string; readonly credit: string };

/** A photograph under video/public/photos, with where it came from. Every one is public domain or CC0, so none asks for credit. */
export interface Photo extends Media {
  readonly shows: string;
  readonly author: string;
  readonly license: "Public domain" | "CC0";
  readonly source: string;
}

/** The photographs, from Wikimedia Commons, each named for the words it sits under. */
export const photos = {
  ai: { file: "photos/ai.jpg", width: 1920, height: 1503, shows: "The Mark I Perceptron learning to read the letter C, around 1958", author: "U.S. Navy", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:330-PSA-80-60_(USN_710739)_(20897323365).jpg" },
  build: { file: "photos/build.jpg", width: 2400, height: 1600, shows: "Coders at laptops at a hackathon, from behind", author: "Flanoz", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Wikimedia_Hackathon_2023_-_Hacking_Room-day2-12.jpg" },
  harness: { file: "photos/harness.jpg", width: 1920, height: 1333, shows: "A harness maker's workshop, Hungary", author: "Fortepan / Erky-Nagy Tibor", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Pet%C5%91fi_utca,_Kormos_sz%C3%ADj%C3%A1rt%C3%B3_mester_m%C5%B1helye._Fortepan_11057.jpg" },
  companies: { file: "photos/companies.jpg", width: 2400, height: 1600, shows: "A glass tower from below", author: "Drew Hays", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Tall_dark_scyscraper_building_(Unsplash).jpg" },
  teams: { file: "photos/teams.jpg", width: 1920, height: 1529, shows: "A row of telephone operators at the switchboard, 1927", author: "U.S. National Archives", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Chesapeake_and_Potomac_Telephone_Company._View_of_row_of_operators._View_of_chairs_showing_type_of_chairs_used_by..._-_NARA_-_522875.tif" },
  computers: { file: "photos/computers.jpg", width: 1920, height: 1251, shows: "Two programmers rewiring ENIAC", author: "U.S. Army", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Reprogramming_ENIAC.png" },
  factory: { file: "photos/factory.jpg", width: 2400, height: 1732, shows: "Ford's assembly line, 1913", author: "Unknown", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Ford_assembly_line_-_1913_(restored).jpg" },
  foundation: { file: "photos/foundation.jpg", width: 2400, height: 1392, shows: "The Leaning Tower of Pisa", author: "Davide Ragusa", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Torre_di_Pisa,_pisa,_italy_(Unsplash).jpg" },
  consistency: { file: "photos/consistency.jpg", width: 1920, height: 1178, shows: "A tangle of overhead wires, Shanghai", author: "Jakub Hałun", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:20090510_Shanghai_Jiangxi_road_wires.jpg" },
  rewrite: { file: "photos/rewrite.jpg", width: 1920, height: 1280, shows: "The Old Georgia Archives building, imploding", author: "Karen", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Old_Georgia_Archives_implosion_(33264352325).jpg" },
  masons: { file: "photos/masons.jpg", width: 1920, height: 1537, shows: "A steelworker on the Empire State Building's frame", author: "Lewis Hine", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Old_timer_structural_worker2.jpg" },
} as const satisfies Record<string, Photo>;

/**
 * The real desktop app, driven by Playwright in a sandbox: a temporary home,
 * an empty store and the e2e suite's scripted model, so no one's sessions show.
 * Takes and stills are 3024×1898, the window at 2×. The TUI stills are the
 * docs' screenshots, packages/docs/public/tui.
 */
export const app = {
  /** "find me a random restaurant nearby": the skill loads, the places MCP server answers, the canvas paints, the agent asks to run a command and answers. */
  restaurant: { file: "footage/restaurant.mp4", width: 3024, height: 1898, video: true },
  /** Two subagents, finished, each reporting back. */
  agents: { file: "footage/agents.mp4", width: 3024, height: 1898, video: true },
  /** The whole window on the restaurant's answer. */
  desktop: { file: "footage/desktop.png", width: 3024, height: 1898 },
  /** The whole window as the canvas paints, the agent asking to run a command. */
  canvas: { file: "footage/canvas.png", width: 3024, height: 1898 },
  /** A new chat: the composer, on this Mac. */
  composer: { file: "footage/composer.png", width: 3024, height: 1898 },
  /** github.com/interfaces-lab/nyte, in GitHub's dark theme. */
  github: { file: "footage/github.png", width: 3024, height: 1898 },
  tuiChat: { file: "footage/tui-chat.png", width: 1968, height: 768 },
  tuiCommands: { file: "footage/tui-commands.png", width: 1968, height: 768 },
  tuiSettings: { file: "footage/tui-settings.png", width: 1968, height: 768 },
} as const satisfies Record<string, Media>;
