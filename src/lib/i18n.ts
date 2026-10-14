import { useSyncExternalStore } from "react";
import type { Kind, Loader, Route } from "../types";
import englishMessages from "../locales/messages/en.json";
import russianMessages from "../locales/messages/ru.json";
import { microsoftEnglish, microsoftRussian } from "../locales/microsoft-login";
import { skinEnglish, skinRussian } from "../locales/skins";
import { profileCreationEnglish, profileCreationRussian } from "../locales/profile-creation";
import { profileIconEnglish, profileIconRussian } from "../locales/profile-icons";
import { updaterEnglish, updaterRussian } from "../locales/updater";
import { homeEnglish, homeRussian } from "../locales/home";
import { languages, resolveLanguage } from "../locales/registry";
type Dictionary = Record<string, string>;
const english: Dictionary = {
  ...englishMessages,
  ...microsoftEnglish,
  ...skinEnglish,
  ...profileCreationEnglish,
  ...profileIconEnglish,
  ...updaterEnglish,
  ...homeEnglish,
};
const russian: Dictionary = {
  ...russianMessages,
  ...microsoftRussian,
  ...skinRussian,
  ...profileCreationRussian,
  ...profileIconRussian,
  ...updaterRussian,
  ...homeRussian,
};
const bundles = import.meta.glob<{ default: Dictionary }>([
  "../locales/messages/*.json",
  "!../locales/messages/en.json",
  "!../locales/messages/ru.json",
]);
const cache = new Map<string, Dictionary>([
  ["ru", russian],
  ["en", english],
]);
const listeners = new Set<() => void>();
const stored =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("aurum:language")
    : null;
let preference =
  stored && ["system", ...languages.map((l) => l.code)].includes(stored)
    ? stored
    : "system";
let locale = resolveLanguage(preference);
let dictionary: Dictionary = cache.get(locale) || english;
let revision = 0;
let snapshotRevision = 0;
const emit = () => {
  snapshotRevision++;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getLocale = () => locale;
export function getFormatLocale() {
  if (preference === "system" && typeof navigator !== "undefined") {
    for (const tag of navigator.languages) {
      try {
        if (resolveLanguage(tag) === locale)
          return Intl.getCanonicalLocales(tag)[0];
      } catch {
        /* try next system language */
      }
    }
  }
  return locale === "pt" ? "pt-PT" : locale;
}
export const getLanguagePreference = () => preference;
export function useLocale() {
  return useSyncExternalStore(
    subscribe,
    () => `${preference}:${locale}:${snapshotRevision}`,
    () => "system:en",
  );
}
function applyDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir =
    languages.find((l) => l.code === locale)?.direction || "ltr";
}
export async function setLanguagePreference(value: string) {
  const nextPreference = ["system", ...languages.map((l) => l.code)].includes(
    value,
  )
    ? value
    : "system";
  const nextLocale = resolveLanguage(nextPreference);
  const ticket = ++revision;
  let next = cache.get(nextLocale);
  if (!next) {
    const loader = bundles[`../locales/messages/${nextLocale}.json`];
    if (!loader) throw new Error(`Language pack unavailable: ${nextLocale}`);
    next = (await loader()).default;
    cache.set(nextLocale, next);
  }
  if (ticket !== revision) return;
  preference = nextPreference;
  locale = nextLocale;
  dictionary = next;
  if (typeof localStorage !== "undefined")
    localStorage.setItem("aurum:language", preference);
  applyDocument();
  emit();
}
applyDocument();
if (typeof window !== "undefined")
  window.addEventListener("languagechange", () => {
    if (preference === "system")
      void setLanguagePreference("system").catch(() => {});
  });
if (!cache.has(locale))
  void setLanguagePreference(preference).catch(() => {
    locale = "en";
    dictionary = english;
    applyDocument();
    emit();
  });
export function t(
  key: string,
  values: Record<string, string | number | boolean | null | undefined> = {},
) {
  const template = dictionary[key] ?? (english as Dictionary)[key] ?? key;
  return template.replace(/\{\{([^}]+)\}\}/g, (placeholder, name) =>
    values[name] === undefined ? placeholder : String(values[name] ?? ""),
  );
}
const patterns = Object.keys(russian)
  .filter((key) => key.includes("{{"))
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const names: string[] = [];
    const pieces = key.split(/(\{\{[^}]+\}\})/g).map((piece) => {
      const placeholder = piece.match(/^\{\{([^}]+)\}\}$/);
      if (placeholder) {
        names.push(placeholder[1]);
        return "([\\s\\S]*?)";
      }
      return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    return { key, names, regex: new RegExp(`^${pieces.join("")}$`) };
  });
export function tMessage(message: string) {
  if (
    dictionary[message] !== undefined ||
    (english as Dictionary)[message] !== undefined
  )
    return t(message);
  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (match)
      return t(
        pattern.key,
        Object.fromEntries(
          pattern.names.map((name, i) => [name, match[i + 1]]),
        ),
      );
  }
  return message;
}
function labels<T extends string>(values: Record<T, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, t(String(value))]),
  ) as Record<T, string>;
}
export const ru = {
  get routes() {
    return labels<Route>({
      home: "Главная",
      profiles: "Мои сборки",
      catalog: "Каталог проектов",
      accounts: "Аккаунты и скины",
      skins: "Скины и плащи",
      settings: "Настройки",
    });
  },
  loaders: {
    vanilla: "Vanilla",
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    quilt: "Quilt",
  } satisfies Record<Loader, string>,
  get kinds() {
    return labels<Kind>({
      mod: "Моды",
      modpack: "Модпаки",
      shader: "Шейдеры",
      resourcepack: "Ресурспаки",
    });
  },
  get phases() {
    return labels({
      migration: "Папка данных",
      metadata: "Метаданные",
      java: "Java",
      libraries: "Библиотеки",
      assets: "Ресурсы игры",
      loader: "Загрузчик",
      content: "Контент",
      pack: "Модпак",
      import: "Импорт",
      auth: "Авторизация",
      "auth-opening": "Вход в Microsoft",
      "auth-waiting": "Подтверждение Microsoft",
      "auth-exchange": "Подключение аккаунта",
      "auth-profile": "Профиль Minecraft Java",
    }) as Record<string, string>;
  },
};
export function formatNumber(n: number) {
  return new Intl.NumberFormat(getFormatLocale(), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
export function formatDecimal(n: number) {
  return new Intl.NumberFormat(getFormatLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}
export function formatCount(n: number) {
  const form = new Intl.PluralRules(locale).select(n);
  return `${formatNumber(n)} ${t(`@project.${form}`) === `@project.${form}` ? t("@project.other") : t(`@project.${form}`)}`;
}
export function getLanguageName(code: string) {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) || code
    );
  } catch {
    return languages.find((l) => l.code === code)?.englishName || code;
  }
}
