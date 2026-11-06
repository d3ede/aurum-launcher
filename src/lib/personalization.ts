import type { Settings } from "../types";

export type HomeBlock = "launch" | "servers" | "profiles" | "discover";
export interface HomePreferences {
  order: HomeBlock[];
  launch: "last-profile" | "last-server" | "profile" | "hidden";
  profileId: string;
  repeatProfile: boolean;
  profileCount: number;
  serverCount: number;
  discovery: "modrinth" | "curseforge" | "modpacks" | "hidden";
  sidebar: boolean;
  background: string;
  backgroundTarget: "page" | "launch";
}
export interface ThemePalette {
  bg: string;
  surface: string;
  sidebar: string;
  text: string;
  secondary: string;
  border: string;
  accent: string;
  accentInk: string;
}
export interface CustomTheme {
  id: string;
  name: string;
  base: "light" | "dark";
  colors: ThemePalette;
}
export interface AppearancePreferences {
  themeId: string;
  themes: CustomTheme[];
  font: string;
  fontData: string;
}
export interface Personalization {
  home: HomePreferences;
  appearance: AppearancePreferences;
}
export type SettingsTab = "general" | "home" | "appearance";
export const homeDefaults: HomePreferences = {
  order: ["launch", "servers", "profiles", "discover"],
  launch: "last-profile",
  profileId: "",
  repeatProfile: false,
  profileCount: 3,
  serverCount: 5,
  discovery: "modrinth",
  sidebar: true,
  background: "",
  backgroundTarget: "launch",
};
export const builtInThemes: CustomTheme[] = [
  {
    id: "garnet",
    name: "Гранатовый шёлк",
    base: "dark",
    colors: {
      bg: "#211219",
      surface: "#321b25",
      sidebar: "#29161f",
      text: "#f9e9ee",
      secondary: "#d4aeba",
      border: "#56303f",
      accent: "#e9c579",
      accentInk: "#f4d697",
    },
  },
  {
    id: "navy",
    name: "Северная глубина",
    base: "dark",
    colors: {
      bg: "#101c30",
      surface: "#192b45",
      sidebar: "#13233b",
      text: "#e8f3ff",
      secondary: "#abc4df",
      border: "#304967",
      accent: "#8cccf2",
      accentInk: "#b5e2ff",
    },
  },
  {
    id: "spring",
    name: "Весенний мох",
    base: "dark",
    colors: {
      bg: "#122a25",
      surface: "#1b3c32",
      sidebar: "#163229",
      text: "#eef9e7",
      secondary: "#b5d4be",
      border: "#355b45",
      accent: "#b8e779",
      accentInk: "#cef29b",
    },
  },
  {
    id: "peach",
    name: "Персиковый рассвет",
    base: "light",
    colors: {
      bg: "#fff5ed",
      surface: "#fffaf6",
      sidebar: "#f6e7dc",
      text: "#49352f",
      secondary: "#796057",
      border: "#e4cabe",
      accent: "#edb39a",
      accentInk: "#96503b",
    },
  },
  {
    id: "lavender",
    name: "Лавандовая ночь",
    base: "dark",
    colors: {
      bg: "#211d33",
      surface: "#2d2845",
      sidebar: "#262139",
      text: "#f2edff",
      secondary: "#c4b8db",
      border: "#4d4267",
      accent: "#c0a2f3",
      accentInk: "#dcc7ff",
    },
  },
];
export function preferences(settings: Settings): Personalization {
  const stored = settings.personalization;
  const home = { ...homeDefaults, ...stored?.home };
  // Older preferences keep working when blocks are added or removed.
  home.order = [
    ...new Set([
      ...(Array.isArray(home.order) ? home.order : []),
      ...homeDefaults.order,
    ]),
  ].filter((id): id is HomeBlock => homeDefaults.order.includes(id));
  for (const key of ["profileCount", "serverCount"] as const)
    home[key] = Number.isFinite(home[key])
      ? Math.max(0, Math.min(12, Math.round(home[key])))
      : homeDefaults[key];
  return {
    home,
    appearance: {
      themeId: stored?.appearance?.themeId || settings.theme,
      themes: stored?.appearance?.themes || [],
      font: stored?.appearance?.font || "",
      fontData: stored?.appearance?.fontData || "",
    },
  };
}

const tokenNames = [
  "bg",
  "surface",
  "sidebar",
  "text",
  "secondary",
  "border",
  "muted",
  "border-strong",
  "surface-translucent",
  "input-soft",
  "gold",
  "gold-hover",
  "gold-soft",
  "gold-border",
  "accent-ink",
  "aside",
  "aside-border",
  "avatar",
  "hover",
  "focus",
  "hero-border",
];
export function applyAppearance(settings: Settings) {
  const root = document.documentElement;
  const appearance = preferences(settings).appearance;
  const theme = [...builtInThemes, ...appearance.themes].find(
    (item) => item.id === appearance.themeId,
  );
  root.dataset.theme =
    theme?.base ||
    (settings.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.theme);
  root.dataset.palette = theme?.id || root.dataset.theme;
  tokenNames.forEach((key) => root.style.removeProperty(`--${key}`));
  if (theme) {
    const c = theme.colors;
    const values: Record<string, string> = {
      bg: c.bg,
      surface: c.surface,
      sidebar: c.sidebar,
      text: c.text,
      secondary: c.secondary,
      border: c.border,
      muted: c.secondary,
      "border-strong": c.border,
      "surface-translucent": `${c.surface}cc`,
      "input-soft": c.bg,
      gold: c.accent,
      "gold-hover": c.accent,
      "gold-soft": `color-mix(in srgb, ${c.accent} 14%, ${c.surface})`,
      "gold-border": `color-mix(in srgb, ${c.accent} 35%, ${c.border})`,
      "accent-ink": c.accentInk,
      aside: c.surface,
      "aside-border": c.border,
      avatar: c.border,
      hover: `color-mix(in srgb, ${c.accent} 8%, ${c.surface})`,
      focus: `${c.accent}80`,
      "hero-border": c.border,
    };
    Object.entries(values).forEach(([key, value]) =>
      root.style.setProperty(`--${key}`, value),
    );
  }
  root.style.setProperty(
    "--app-font",
    appearance.fontData
      ? '"Aurum User Font"'
      : appearance.font
        ? `${JSON.stringify(appearance.font)}, "Inter Variable", sans-serif`
        : '"Inter Variable", "Segoe UI", sans-serif',
  );
}

let loadedFont: FontFace | undefined;
let loadedFontData = "";
let fontRevision = 0;
export async function applyFont(data: string) {
  const revision = ++fontRevision;
  if (data === loadedFontData) return;
  const font = data
    ? await new FontFace(
        "Aurum User Font",
        `url(${JSON.stringify(data)})`,
      ).load()
    : undefined;
  if (revision !== fontRevision) return;
  if (loadedFont) document.fonts.delete(loadedFont);
  if (font) document.fonts.add(font);
  loadedFont = font;
  loadedFontData = data;
}
export async function readPersonalFile(
  file: File,
  kind: "image" | "font",
): Promise<string> {
  const valid =
    kind === "image"
      ? /^image\/(png|jpeg|webp)$/.test(file.type)
      : /\.(woff2?|ttf|otf)$/i.test(file.name);
  if (!valid || file.size > 2 * 1024 * 1024)
    throw new Error("Выберите подходящий файл размером до 2 МБ.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}
