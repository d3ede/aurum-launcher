export type GameCategory =
  "graphics" | "fov" | "controls" | "mouse" | "sound" | "interface";
export interface GameSettingsPreset {
  id: string;
  name: string;
  sourceVersion: string;
  sourceName: string;
  options: string;
  categories: GameCategory[];
}
export const gameCategories: GameCategory[] = [
  "graphics",
  "fov",
  "controls",
  "mouse",
  "sound",
  "interface",
];
export interface GameOption {
  key: string;
  group: GameCategory;
  type: "range" | "boolean" | "select";
  value: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
  since?: number;
  percent?: boolean;
}
const range = (
  key: string,
  group: GameCategory,
  value: string,
  min: number,
  max: number,
  step: number,
  since = 7,
  percent = false,
): GameOption => ({
  key,
  group,
  type: "range",
  value,
  min,
  max,
  step,
  since,
  percent,
});
const bool = (
  key: string,
  group: GameCategory,
  value = "true",
  since = 7,
): GameOption => ({ key, group, type: "boolean", value, since });
export const gameOptions: GameOption[] = [
  range("fov", "fov", "0", -1, 1, 0.025),
  bool("bobView", "fov"),
  range("fovEffectScale", "fov", "1", 0, 1, 0.01, 16, true),
  range("mouseSensitivity", "mouse", "0.5", 0, 1, 0.005, 7, true),
  bool("invertYMouse", "mouse", "false"),
  bool("rawMouseInput", "mouse", "true", 14),
  range("mouseWheelSensitivity", "mouse", "1", 0.01, 10, 0.01, 14),
  bool("discrete_mouse_scroll", "mouse", "false", 14),
  bool("touchscreen", "mouse", "false"),
  bool("autoJump", "controls", "false", 10),
  bool("toggleCrouch", "controls", "false", 15),
  bool("toggleSprint", "controls", "false", 15),
  range("renderDistance", "graphics", "12", 2, 32, 1),
  range("simulationDistance", "graphics", "12", 5, 32, 1, 18),
  range("maxFps", "graphics", "120", 10, 260, 10),
  bool("enableVsync", "graphics"),
  {
    key: "graphicsMode",
    group: "graphics",
    type: "select",
    value: "1",
    since: 16,
    choices: [
      ["0", "@game.fast"],
      ["1", "@game.fancy"],
      ["2", "@game.fabulous"],
    ],
  },
  { key: "fancyGraphics", group: "graphics", type: "boolean", value: "true" },
  {
    key: "graphicsPreset",
    group: "graphics",
    type: "select",
    value: "fancy",
    choices: [
      ["fast", "@game.fast"],
      ["fancy", "@game.fancy"],
      ["fabulous", "@game.fabulous"],
      ["custom", "@game.custom"],
    ],
  },
  {
    key: "particles",
    group: "graphics",
    type: "select",
    value: "0",
    choices: [
      ["0", "@game.all"],
      ["1", "@game.decreased"],
      ["2", "@game.minimal"],
    ],
  },
  bool("entityShadows", "graphics", "true", 8),
  range("entityDistanceScaling", "graphics", "1", 0.5, 5, 0.25, 16, true),
  range("gamma", "graphics", "0.5", 0, 1, 0.01, 7, true),
  range("mipmapLevels", "graphics", "4", 0, 4, 1),
  range("biomeBlendRadius", "graphics", "2", 0, 7, 1, 14),
  ...[
    "master",
    "music",
    "record",
    "weather",
    "block",
    "hostile",
    "neutral",
    "player",
    "ambient",
    "voice",
  ].map((key) =>
    range(`soundCategory_${key}`, "sound", "1", 0, 1, 0.01, 7, true),
  ),
  range("guiScale", "interface", "0", 0, 6, 1),
  {
    key: "lang",
    group: "interface",
    type: "select",
    value: "en_us",
    choices: [
      ["en_us", "English (US)"],
      ["en_gb", "English (UK)"],
      ["ru_ru", "Русский"],
      ["uk_ua", "Українська"],
      ["et_ee", "Eesti"],
      ["de_de", "Deutsch"],
      ["fr_fr", "Français"],
      ["es_es", "Español"],
      ["pt_br", "Português (Brasil)"],
      ["pl_pl", "Polski"],
      ["ja_jp", "日本語"],
      ["zh_cn", "简体中文"],
    ],
  },
  bool("forceUnicodeFont", "interface", "false"),
  bool("showSubtitles", "interface", "false", 9),
  range("chatScale", "interface", "1", 0, 1, 0.01, 7, true),
  range("chatOpacity", "interface", "1", 0, 1, 0.01, 7, true),
  range("chatWidth", "interface", "1", 0, 1, 0.01, 7, true),
  range("chatHeightFocused", "interface", "1", 0, 1, 0.01, 7, true),
  range(
    "chatHeightUnfocused",
    "interface",
    "0.44366197183098594",
    0,
    1,
    0.01,
    7,
    true,
  ),
];

export function releaseMinor(version: string): number | null {
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (m) return Number(m[1]);
  return /^\d{2}\.\d+(?:\.\d+)?$/.test(version) &&
    Number(version.split(".")[0]) >= 26
    ? 100
    : null;
}
export function usesGraphicsPresets(version: string) {
  return (
    (releaseMinor(version) ?? 0) > 21 ||
    (/^1\.21\.(\d+)$/.test(version) && Number(version.split(".")[2]) >= 11)
  );
}
export function parseGameOptions(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .flatMap((line) => {
        const colon = line.indexOf(":");
        return colon > 0 ? [[line.slice(0, colon), line.slice(colon + 1)]] : [];
      }),
  );
}
export function editGameOption(
  raw: string,
  key: string,
  value: string,
): string {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw
    .split(/\r?\n/)
    .filter(
      (line) => line && line.replace(/^\uFEFF/, "").split(":", 1)[0] !== key,
    );
  return [...lines, `${key}:${value}`, ""].join(newline);
}
export function supportedGameOptions(
  preset: GameSettingsPreset,
  group: GameCategory,
) {
  const minor = releaseMinor(preset.sourceVersion),
    values = parseGameOptions(preset.options);
  return gameOptions.filter(
    (o) =>
      o.group === group &&
      (minor === null ? o.key in values : minor >= (o.since ?? 7)) &&
      (o.key !== "graphicsPreset" ||
        usesGraphicsPresets(preset.sourceVersion)) &&
      (o.key !== "graphicsMode" ||
        !usesGraphicsPresets(preset.sourceVersion)) &&
      (o.key !== "fancyGraphics" || (minor !== null && minor < 16)),
  );
}
export function blankGamePreset(name: string): GameSettingsPreset {
  const preset: GameSettingsPreset = {
    id: crypto.randomUUID(),
    name,
    sourceName: "",
    sourceVersion: "1.21.1",
    options: "",
    categories: [...gameCategories],
  };
  for (const group of gameCategories)
    for (const o of supportedGameOptions(preset, group))
      preset.options = editGameOption(preset.options, o.key, o.value);
  for (const [key, value] of Object.entries(defaultBindings))
    preset.options = editGameOption(preset.options, `key_key.${key}`, value);
  return preset;
}
export const defaultBindings: Record<string, string> = {
  forward: "key.keyboard.w",
  left: "key.keyboard.a",
  back: "key.keyboard.s",
  right: "key.keyboard.d",
  jump: "key.keyboard.space",
  sneak: "key.keyboard.left.shift",
  sprint: "key.keyboard.left.control",
  inventory: "key.keyboard.e",
  drop: "key.keyboard.q",
  swapOffhand: "key.keyboard.f",
  attack: "key.mouse.left",
  use: "key.mouse.right",
  pickItem: "key.mouse.middle",
  chat: "key.keyboard.t",
  command: "key.keyboard.slash",
  playerlist: "key.keyboard.tab",
  togglePerspective: "key.keyboard.f5",
  screenshot: "key.keyboard.f2",
  fullscreen: "key.keyboard.f11",
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `hotbar.${i + 1}`,
      `key.keyboard.${i + 1}`,
    ]),
  ),
};
export function bindingFromEvent(event: KeyboardEvent): string | null {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code))
    return `key.keyboard.${code.slice(3).toLowerCase()}`;
  if (/^Digit\d$/.test(code)) return `key.keyboard.${code.slice(5)}`;
  if (/^F([1-9]|1\d|2[0-5])$/.test(code))
    return `key.keyboard.${code.toLowerCase()}`;
  const keys: Record<string, string> = {
    Space: "space",
    Enter: "enter",
    Tab: "tab",
    Backspace: "backspace",
    Delete: "delete",
    Insert: "insert",
    Home: "home",
    End: "end",
    PageUp: "page.up",
    PageDown: "page.down",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    ShiftLeft: "left.shift",
    ShiftRight: "right.shift",
    ControlLeft: "left.control",
    ControlRight: "right.control",
    AltLeft: "left.alt",
    AltRight: "right.alt",
    Minus: "minus",
    Equal: "equal",
    BracketLeft: "left.bracket",
    BracketRight: "right.bracket",
    Backslash: "backslash",
    Semicolon: "semicolon",
    Quote: "apostrophe",
    Backquote: "grave.accent",
    Comma: "comma",
    Period: "period",
    Slash: "slash",
    CapsLock: "caps.lock",
    NumLock: "num.lock",
    ScrollLock: "scroll.lock",
    NumpadEnter: "keypad.enter",
    NumpadAdd: "keypad.add",
    NumpadSubtract: "keypad.subtract",
    NumpadMultiply: "keypad.multiply",
    NumpadDivide: "keypad.divide",
    NumpadDecimal: "keypad.decimal",
  };
  if (/^Numpad\d$/.test(code)) return `key.keyboard.keypad.${code.slice(6)}`;
  return keys[code] ? `key.keyboard.${keys[code]}` : null;
}
const legacyNames: Record<string, string> = {
  "1":"escape","12":"minus","13":"equal","14":"backspace",
  "19":"r","21":"y","22":"u","23":"i","24":"o","25":"p","26":"left.bracket","27":"right.bracket","28":"enter",
  "34":"g","35":"h","36":"j","37":"k","38":"l","39":"semicolon","40":"apostrophe","41":"grave.accent","43":"backslash",
  "44":"z","45":"x","46":"c","47":"v","48":"b","49":"n","50":"m","51":"comma","52":"period","54":"right.shift","55":"keypad.multiply","56":"left.alt","58":"caps.lock",
  "59":"f1","61":"f3","62":"f4","64":"f6","65":"f7","66":"f8","67":"f9","68":"f10","69":"num.lock","70":"scroll.lock","71":"keypad.7","72":"keypad.8","73":"keypad.9","74":"keypad.subtract","75":"keypad.4","76":"keypad.5","77":"keypad.6","78":"keypad.add","79":"keypad.1","80":"keypad.2","81":"keypad.3","82":"keypad.0","83":"keypad.decimal","88":"f12",
  "156":"keypad.enter","157":"right.control","181":"keypad.divide","184":"right.alt","199":"home","200":"up","201":"page.up","203":"left","205":"right","207":"end","208":"down","209":"page.down","210":"insert","211":"delete","219":"left.win","220":"right.win",
  "17": "w",
  "30": "a",
  "31": "s",
  "32": "d",
  "57": "space",
  "42": "left.shift",
  "29": "left.control",
  "18": "e",
  "16": "q",
  "33": "f",
  "20": "t",
  "53": "slash",
  "15": "tab",
  "63": "f5",
  "60": "f2",
  "87": "f11",
  "-100": "mouse.left",
  "-99": "mouse.right",
  "-98": "mouse.middle",
  "0": "unknown",
};
export function displayBinding(value: string): string {
  let key = legacyNames[value] ?? value;
  if (/^([2-9]|10|11)$/.test(key)) key = String((Number(key) - 1) % 10);
  return key
    .replace(/^key\.(keyboard\.|mouse\.)?/, "")
    .replaceAll(".", " ")
    .toUpperCase();
}
