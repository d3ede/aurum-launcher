import { describe, expect, it, vi } from "vitest";
import {
  iconColors,
  iconBackgrounds,
  iconSymbols,
  randomIconStyle,
} from "../src/lib/profile-icons";

// Independent sRGB calculation checks the final rounded HEX colors.
function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const x = parseInt(value, 16) / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("random instance artwork", () => {
  it("generates varied full-spectrum palettes with readable contrast", () => {
    let seed = 15483;
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    });
    try {
      const colors = new Set<string>();
      const backgrounds = new Set<string>();
      const symbols = new Set<string>();
      let light = 0;
      for (let i = 0; i < 4000; i++) {
        const style = randomIconStyle();
        expect(style.color).toMatch(/^#[0-9A-F]{6}$/);
        expect(style.background).toMatch(/^#[0-9A-F]{6}$/);
        const a = luminance(style.color),
          b = luminance(style.background);
        expect(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
        if (b > a) light++;
        colors.add(style.color);
        backgrounds.add(style.background);
        symbols.add(style.symbol);
      }
      expect(light).toBeGreaterThan(1000);
      expect(light).toBeLessThan(3000);
      expect(colors.size).toBeGreaterThan(3000);
      expect(backgrounds.size).toBeGreaterThan(3000);
      expect([...colors].some((color) => iconColors.includes(color))).toBe(
        false,
      );
      expect(
        [...backgrounds].some((color) => iconBackgrounds.includes(color)),
      ).toBe(false);
      expect(symbols).toEqual(
        new Set(iconSymbols.slice(0, 16).map(({ id }) => id)),
      );
    } finally {
      random.mockRestore();
    }
  });
});
