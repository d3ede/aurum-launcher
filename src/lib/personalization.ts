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
  {
    id: "graphite",
    name: "Графит",
    base: "dark",
    colors: {
      bg: "#181a1f",
      surface: "#24272e",
      sidebar: "#1e2026",
      text: "#eceef4",
      secondary: "#b3bac8",
      border: "#3b404c",
      accent: "#a7b8e5",
      accentInk: "#c6d2ef",
    },
  },
  {
    id: "espresso",
    name: "Экспрессо",
    base: "dark",
    colors: {
      bg: "#211915",
      surface: "#30241e",
      sidebar: "#281e19",
      text: "#f6eadf",
      secondary: "#ceb8a6",
      border: "#574033",
      accent: "#d9a47e",
      accentInk: "#edc4a6",
    },
  },
  {
    id: "volcano",
    name: "Вулкан",
    base: "dark",
    colors: {
      bg: "#101113",
      surface: "#1b1d21",
      sidebar: "#151619",
      text: "#f5f3f1",
      secondary: "#b9bbc2",
      border: "#36383c",
      accent: "#ff6b35",
      accentInk: "#ff8050",
    },
  },
  {
    id: "polar",
    name: "Полярное утро",
    base: "light",
    colors: {
      bg: "#f0f6fc",
      surface: "#ffffff",
      sidebar: "#e3edf8",
      text: "#24364b",
      secondary: "#566981",
      border: "#c6d6e8",
      accent: "#78a8e6",
      accentInk: "#225da6",
    },
  },
  {
    id: "sakura",
    name: "Сакура",
    base: "light",
    colors: {
      bg: "#fff3f6",
      surface: "#fffafd",
      sidebar: "#f5e4eb",
      text: "#4a2d40",
      secondary: "#7d586d",
      border: "#e6c8d6",
      accent: "#eaa8ba",
      accentInk: "#9b3b60",
    },
  },
  {
    id: "porcelain",
    name: "Мятный фарфор",
    base: "light",
    colors: {
      bg: "#f1f8f5",
      surface: "#fcfffd",
      sidebar: "#e1efe8",
      text: "#263e36",
      secondary: "#526b61",
      border: "#bed8cb",
      accent: "#80c7b5",
      accentInk: "#236354",
    },
  },
  {
    id: "dune",
    name: "Песчаный берег",
    base: "light",
    colors: {
      bg: "#faf5e9",
      surface: "#fffcf5",
      sidebar: "#eee6d3",
      text: "#44392d",
      secondary: "#70604d",
      border: "#dacbb1",
      accent: "#dca78b",
      accentInk: "#8d4834",
    },
  },
];

export function themeBaseColors(base: CustomTheme["base"]): ThemePalette {
  const preset = builtInThemes.find(
    (item) => item.id === (base === "light" ? "polar" : "graphite"),
  )!;
  return { ...preset.colors };
}
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
