import { describe, expect, it } from "vitest";
import { validSkinName } from "../src/lib/skin-browser";

describe("skin library names", () => {
  it("accepts trimmed names and enforces the library's UTF-8 limit", () => {
    for (const value of [
      "Knight",
      "  Синий рыцарь  ",
      "Без названия",
      "a".repeat(120),
      "🐉".repeat(30),
    ])
      expect(validSkinName(value)).toBe(true);
    for (const value of ["", "   ", "a".repeat(121), "🐉".repeat(31)])
      expect(validSkinName(value)).toBe(false);
  });
});
