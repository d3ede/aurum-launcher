import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import uk from "../src/locales/messages/uk.json";
import en from "../src/locales/messages/en.json";
import ru from "../src/locales/messages/ru.json";
import {
  formatCount,
  setLanguagePreference,
  t,
  tMessage,
} from "../src/lib/i18n";

const ukrainian: Record<string, string> = uk;
const modules = import.meta.glob<Record<string, Record<string, string>>>(
  "../src/locales/*.ts",
  { eager: true },
);
const source: Record<string, string> = { ...en, ...ru };
for (const module of Object.values(modules))
  for (const [name, messages] of Object.entries(module))
    if (name.endsWith("English") || name.endsWith("Russian"))
      Object.assign(source, messages);

const placeholders = (value: string) =>
  value.match(/\{\{[^}]+\}\}/g)?.sort() || [];

afterEach(async () => {
  await setLanguagePreference("ru");
});

describe("reviewed Ukrainian localization", () => {
  it("covers the full current catalog, including feature dictionaries and backend messages", () => {
    for (const [key, value] of Object.entries(source)) {
      expect(
        ukrainian[key],
        `Missing Ukrainian translation: ${key}`,
      ).toBeTruthy();
      expect(placeholders(ukrainian[key]), key).toEqual(placeholders(value));
    }
    for (const [key, value] of Object.entries(ukrainian)) {
      expect(value, key).not.toMatch(/[ыэёъ�⁇]/i);
      expect(value, key).not.toMatch(/^@(?:social|project)\./);
      if (key.includes("{{"))
        expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });

  it("covers engine statuses and errors as well as screen labels", () => {
    const missing = new Set<string>();
    function scan(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "tests") scan(file);
          continue;
        }
        if (!file.endsWith(".rs")) continue;
        const text = readFileSync(file, "utf8").split("#[cfg(test)]")[0];
        for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
          const value = match[1].replaceAll("\\n", "\n").replaceAll('\\"', '"');
          if (!/[а-яё]/i.test(value) || value.includes("=>")) continue;
          let index = 0;
          const key = value.replace(/\{[^{}]*\}/g, () => `{{v${++index}}}`);
          if (!ukrainian[value] && !ukrainian[key])
            missing.add(`${file}: ${key}`);
        }
      }
    }
    scan(fileURLToPath(new URL("../crates/auren-core/src", import.meta.url)));
    scan(fileURLToPath(new URL("../src-tauri/src", import.meta.url)));
    expect([...missing]).toEqual([]);
  });

  it("covers literal and conditional translation calls introduced outside the catalogs", () => {
    const missing: string[] = [];
    function scan(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const file = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!["locales", "assets"].includes(entry.name)) scan(file);
          continue;
        }
        if (!/\.tsx?$/.test(file)) continue;
        const ast = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        function check(node: ts.Node) {
          if (
            ts.isStringLiteralLike(node) &&
            node.text &&
            !ukrainian[node.text]
          )
            missing.push(`${file}: ${node.text}`);
          else if (ts.isConditionalExpression(node)) {
            check(node.whenTrue);
            check(node.whenFalse);
          }
        }
        function visit(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            ["t", "tMessage"].includes(node.expression.getText(ast)) &&
            node.arguments[0]
          )
            check(node.arguments[0]);
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
    scan(fileURLToPath(new URL("../src", import.meta.url)));
    expect(missing).toEqual([]);
  });

  it("uses consistent Minecraft terms, preserves user data and formats Ukrainian plurals", async () => {
    await setLanguagePreference("uk");
    for (const [key, value] of Object.entries({
      Журнал: "Журнал",
      Мобы: "Моби",
      "Мои сборки": "Мої збірки",
      "Удалить сборку": "Видалити збірку",
      "Аккаунт выбран": "Обліковий запис вибрано",
      "Скин загружен": "Скін завантажено",
      "Показывать снапшоты Minecraft": "Показувати снапшоти Minecraft",
      "@social.title": "Друзі",
    }))
      expect(t(key), key).toBe(value);
    const path = "D:/Сборка <test>/Fabric";
    expect(t("Открыть {{v1}}", { v1: path })).toBe(`Відкрити ${path}`);
    expect(tMessage("Требуется Java 21, выбрана Java 8")).toBe(
      "Потрібна Java 21, вибрано Java 8",
    );
    expect(tMessage("Wrong backup password or damaged file")).toBe(
      "Неправильний пароль або пошкоджена резервна копія.",
    );
    expect(tMessage("Переносим сборку · My pack")).toBe(
      "Переносимо збірку · My pack",
    );
    expect(
      tMessage("Не удалось запустить сервер: Папка сборки не найдена"),
    ).toBe("Не вдалося запустити сервер: Папку збірки не знайдено");
    expect(
      tMessage("Не удалось запустить сервер: Access is denied (os error 5)"),
    ).toBe("Не вдалося запустити сервер: Access is denied (os error 5)");
    expect(tMessage("[Server thread/INFO]: Player joined the game")).toBe(
      "[Server thread/INFO]: Player joined the game",
    );
    for (const [count, noun] of [
      [1, "проєкт"],
      [2, "проєкти"],
      [5, "проєктів"],
      [11, "проєктів"],
      [21, "проєкт"],
      [22, "проєкти"],
      [25, "проєктів"],
      [1.5, "проєкту"],
    ] as const)
      expect(formatCount(count)).toBe(
        `${new Intl.NumberFormat("uk").format(count)} ${noun}`,
      );
    await setLanguagePreference("en");
    expect(tMessage("Переносим сборку · My pack")).toBe(
      "Переносим сборку · My pack",
    );
    await setLanguagePreference("uk");
    expect(tMessage("Переносим сборку · My pack")).toBe(
      "Переносимо збірку · My pack",
    );
  });
});
