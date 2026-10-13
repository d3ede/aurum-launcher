import type { SavedSkin } from "../types";
const textures = import.meta.glob<string>("../assets/skins/{wide,slim}-*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
export const defaultSkins: SavedSkin[] = [
  "Steve",
  "Alex",
  "Ari",
  "Efe",
  "Kai",
  "Makena",
  "Noor",
  "Sunny",
  "Zuri",
].map((name) => {
  const model = name === "Steve" ? ("steve" as const) : ("alex" as const);
  return {
    id: `default:${name.toLowerCase()}`,
    name,
    model,
    texture:
      textures[
        `../assets/skins/${model === "alex" ? "slim" : "wide"}-${name.toLowerCase()}.png`
      ],
    capeId: null,
  };
});
export function defaultSkinImage(id: string, model: "steve" | "alex") {
  return textures[
    `../assets/skins/${model === "alex" ? "slim" : "wide"}-${id.replace("default:", "")}.png`
  ];
}
export function textureBytes(texture: string) {
  return Array.from(atob(texture.split(",")[1]), (c) => c.charCodeAt(0));
}
export function textureData(bytes: number[]) {
  let s = "";
  for (const n of bytes) s += String.fromCharCode(n);
  return `data:image/png;base64,${btoa(s)}`;
}
