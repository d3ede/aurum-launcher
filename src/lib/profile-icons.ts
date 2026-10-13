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
