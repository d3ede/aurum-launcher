import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { languages, resolveLanguage } from "../src/locales/registry";
import {
  t,
  tMessage,
  setLanguagePreference,
  formatDecimal,
  formatCount,
} from "../src/lib/i18n";
const messages = (code: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../src/locales/messages/${code}.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, string>;
afterEach(async () => {
  await setLanguagePreference("ru");
});
describe("offline language packs", () => {
  it("covers every registered language and preserves interpolation values", () => {
    const base = messages("ru");
    expect(languages.length).toBe(41);
    for (const language of languages) {
      const pack = messages(language.code);
      for (const [key, value] of Object.entries(base)) {
        expect(pack[key], `${language.code}: ${key}`).toBeTruthy();
        expect(pack[key].match(/\{\{[^}]+\}\}/g)?.sort() || []).toEqual(
          value.match(/\{\{[^}]+\}\}/g)?.sort() || [],
        );
      }
    }
  });
  it("resolves regional and system preferences with an English fallback", () => {
    expect(resolveLanguage("system", ["es-MX", "en"])).toBe("es");
    expect(resolveLanguage("system", ["xx-XX", "uk-UA"])).toBe("uk");
    expect(resolveLanguage("zh-TW")).toBe("zh-Hant");
    expect(resolveLanguage("zh-CN")).toBe("zh-Hans");
    expect(resolveLanguage("no-NO")).toBe("nb");
    expect(resolveLanguage("unknown")).toBe("en");
  });
  it("switches dictionaries and formats numbers and plurals", async () => {
    await setLanguagePreference("es");
    expect(t("Главная")).toBe("Inicio");
    expect(formatDecimal(4.5)).toBe("4,5");
    expect(formatCount(1)).toBe("1 proyecto");
    await setLanguagePreference("uk");
    expect(t("Настройки")).toBe("Налаштування");
    expect(formatCount(5)).toBe("5 проєктів");
    await setLanguagePreference("en");
    expect(formatCount(1)).toBe("1 project");
    expect(formatCount(2)).toBe("2 projects");
    const name = "Сборка <test>";
    expect(t("Открыть {{v1}}", { v1: name })).toBe(`Open ${name}`);
    expect(tMessage("Требуется Java 21, выбрана Java 8")).toBe(
      "Java 21 is required, Java 8 is selected",
    );
    expect(tMessage("raw Minecraft log output")).toBe(
      "raw Minecraft log output",
    );
  });
});
