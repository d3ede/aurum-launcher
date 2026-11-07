import {
  Box,
  Trees,
  Mountain,
  Compass,
  Pickaxe,
  Sword,
  Flame,
  Snowflake,
  Moon,
  Sun,
  Star,
  Heart,
  Gem,
  Ghost,
  Rocket,
  Gamepad2,
} from "lucide-react";
import type { ProfileIconStyle } from "../types";
import {
  FabricGlyph,
  ForgeGlyph,
  NeoForgeGlyph,
  QuiltGlyph,
  VanillaGlyph,
  HorizonGlyph,
} from "../components/LoaderLogo";

export const iconSymbols = [
  { id: "box", label: "Куб", Icon: Box },
  { id: "trees", label: "Лес", Icon: Trees },
  { id: "mountain", label: "Горы", Icon: Mountain },
  { id: "compass", label: "Компас", Icon: Compass },
  { id: "pickaxe", label: "Кирка", Icon: Pickaxe },
  { id: "sword", label: "Меч", Icon: Sword },
  { id: "flame", label: "Огонь", Icon: Flame },
  { id: "snowflake", label: "Снежинка", Icon: Snowflake },
  { id: "moon", label: "Луна", Icon: Moon },
  { id: "sun", label: "Солнце", Icon: Sun },
  { id: "star", label: "Звезда", Icon: Star },
  { id: "heart", label: "Сердце", Icon: Heart },
  { id: "gem", label: "Кристалл", Icon: Gem },
  { id: "ghost", label: "Призрак", Icon: Ghost },
  { id: "rocket", label: "Ракета", Icon: Rocket },
  { id: "gamepad", label: "Геймпад", Icon: Gamepad2 },
  { id: "vanilla", label: "Vanilla", Icon: VanillaGlyph },
  { id: "fabric", label: "Fabric", Icon: FabricGlyph },
  { id: "forge", label: "Forge", Icon: ForgeGlyph },
  { id: "neoforge", label: "NeoForge", Icon: NeoForgeGlyph },
  { id: "quilt", label: "Quilt", Icon: QuiltGlyph },
  { id: "horizon", label: "Horizon", Icon: HorizonGlyph },
] as const;

export const iconColors = [
  "#F3CC69",
  "#B1D1A1",
  "#B3CBE9",
  "#E5B99A",
  "#C8B3EB",
  "#EF9FAE",
  "#FFFFFF",
  "#382010",
];
export const iconBackgrounds = [
  "#4A402A",
  "#304632",
  "#334152",
  "#4C3B32",
  "#3E3256",
  "#542F3C",
  "#F3CC69",
  "#F1EEE7",
];
export const validIconColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function hslHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const component = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(
      255 *
        (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${component(0)}${component(8)}${component(4)}`.toUpperCase();
}

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

/** Related hues from the full color wheel, with at least 4.5:1 contrast. */
export function randomIconStyle(): ProfileIconStyle {
  const hue = Math.random() * 360;
  const saturation = 0.35 + Math.random() * 0.4;
  const lightBackground = Math.random() < 0.5;
  const background = hslHex(
    hue,
    saturation * 0.55,
    lightBackground ? 0.83 + Math.random() * 0.1 : 0.13 + Math.random() * 0.1,
  );
  const symbolHue = (hue + Math.random() * 50 - 25 + 360) % 360;
  let lightness = lightBackground ? 0.24 : 0.8;
  let color = hslHex(symbolHue, saturation, lightness);
  const backgroundLuminance = luminance(background);
  const contrast = () =>
    (Math.max(luminance(color), backgroundLuminance) + 0.05) /
    (Math.min(luminance(color), backgroundLuminance) + 0.05);
  while (contrast() < 4.5 && lightness > 0 && lightness < 1) {
    lightness = Math.max(
      0,
      Math.min(1, lightness + (lightBackground ? -0.02 : 0.02)),
    );
    color = hslHex(symbolHue, saturation, lightness);
  }
  // Loader logos describe a specific runtime, so random picks use general symbols.
  const symbols = iconSymbols.filter(
    ({ id }) =>
      !["vanilla", "fabric", "forge", "neoforge", "quilt", "horizon"].includes(
        id,
      ),
  );
  return {
    symbol: symbols[Math.floor(Math.random() * symbols.length)].id,
    color,
    background,
  };
}

export function defaultIconStyle(
  cover: number,
  dark = false,
): ProfileIconStyle {
  const index = ((cover % 4) + 4) % 4;
  const colors = dark
    ? iconColors
    : ["#745921", "#456544", "#4D6684", "#916C4D"];
  const backgrounds = dark
    ? iconBackgrounds
    : ["#F1E4B8", "#DBE7D5", "#DBE4EF", "#EBDCD0"];
  return {
    symbol: iconSymbols[index].id,
    color: colors[index],
    background: backgrounds[index],
  };
}
