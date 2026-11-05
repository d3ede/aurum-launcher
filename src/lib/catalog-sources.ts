import type { CatalogSource } from "../types";

export const catalogSources: Record<CatalogSource, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  atlauncher: "ATLauncher",
  ftb: "FTB",
  technic: "Technic",
  horizon: "Horizon",
};
export const packSource = (source: string) =>
  ["atlauncher", "ftb", "technic"].includes(source);
export const catalogWebsite = (source: CatalogSource) =>
  ({
    modrinth: "https://modrinth.com/modpacks",
    curseforge: "https://www.curseforge.com/minecraft",
    atlauncher: "https://atlauncher.com/packs",
    ftb: "https://www.feed-the-beast.com/modpacks",
    technic: "https://www.technicpack.net/modpacks",
    horizon: "https://playhorizon.dev/mods",
  })[source];
