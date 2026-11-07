import type { SavedSkin } from "../types";

export type BrowserEntry = {
  id: string;
  name: string | null;
  shortId: string | null;
  hash: string;
};
export type BrowserAppearance = Omit<SavedSkin, "name" | "capeId"> & {
  name: string | null;
  shortId: string | null;
};

export function validSkinName(name: string) {
  return !!name.trim() && new TextEncoder().encode(name.trim()).length <= 120;
}
