import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { languages, resolveLanguage } from "../src/locales/registry";
import {
  t,
  tMessage,
  setLanguagePreference,
  formatDecimal,
  formatCount,
  ru,
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
  it("translates dependency diagnostics while preserving names, loader and recovery link", async () => {
    const message = "Не удалось установить «Bark Stripping»: нужна зависимость «Farmer's Delight Refabricated», но в Modrinth нет версии для Minecraft 1.20.1 / Forge.\nВыберите другую версию аддона или проверьте требования зависимости: https://modrinth.com/project/7vxePowz";
    await setLanguagePreference("en");
    expect(tMessage(message)).toBe("Could not install “Bark Stripping”: the required dependency “Farmer's Delight Refabricated” has no version for Minecraft 1.20.1 / Forge on Modrinth.\nChoose another addon version or check the dependency requirements: https://modrinth.com/project/7vxePowz");
    await setLanguagePreference("uk");
    expect(tMessage(message)).toContain("Farmer's Delight Refabricated");
    expect(tMessage(message)).toContain("https://modrinth.com/project/7vxePowz");
    expect(tMessage(message)).toContain("Не вдалося встановити");
  });
  it("uses the current language for the Friends navigation label",async()=>{
    await setLanguagePreference("ru");expect(ru.routes.friends).toBe("Друзья");
    await setLanguagePreference("en");expect(ru.routes.friends).toBe("Friends");
    await setLanguagePreference("ru");expect(ru.routes.friends).toBe("Друзья");
  });
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
