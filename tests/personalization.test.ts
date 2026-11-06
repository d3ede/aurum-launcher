import { describe, expect, it } from "vitest";
import {
  builtInThemes,
  homeDefaults,
  preferences,
} from "../src/lib/personalization";
import { defaultSettings } from "../src/lib/api";

describe("personalization compatibility", () => {
  it("keeps every bundled palette readable with a distinct main color and accent", () => {
    const luminance = (color: string) => {
      const rgb = [1, 3, 5]
        .map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const contrast = (a: string, b: string) => {
      const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    expect(
      new Set(builtInThemes.map((theme) => theme.colors.accent)).size,
    ).toBe(builtInThemes.length);
    expect(new Set(builtInThemes.map((theme) => theme.colors.bg)).size).toBe(
      builtInThemes.length,
    );
    for (const theme of builtInThemes) {
      for (const background of [
        theme.colors.bg,
        theme.colors.surface,
        theme.colors.sidebar,
      ]) {
        for (const foreground of [
          theme.colors.text,
          theme.colors.secondary,
          theme.colors.accentInk,
        ])
          expect(
            contrast(foreground, background),
            `${theme.id}: ${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast("#382f1b", theme.colors.accent),
        `${theme.id}: primary button`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the existing home layout for legacy settings", () => {
    const result = preferences(defaultSettings);
    expect(result.home).toEqual(homeDefaults);
    expect(result.appearance.themeId).toBe("light");
    result.home.order.reverse();
    expect(homeDefaults.order[0]).toBe("launch");
  });
  it("keeps saved order, adds missing blocks and clamps invalid counts", () => {
    const result = preferences({
      ...defaultSettings,
      personalization: {
        home: {
          ...homeDefaults,
          order: ["discover", "discover", "profiles"],
          serverCount: -10,
          profileCount: 100,
        },
        appearance: {
          themeId: "navy",
          themes: [],
          font: "Georgia",
          fontData: "",
        },
      },
    });
    expect(result.home.order).toEqual([
      "discover",
      "profiles",
      "launch",
      "servers",
    ]);
    expect(result.home.serverCount).toBe(0);
    expect(result.home.profileCount).toBe(12);
    expect(result.appearance.themeId).toBe("navy");
  });
});
