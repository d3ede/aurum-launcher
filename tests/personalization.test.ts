import { describe, expect, it } from "vitest";
import { homeDefaults, preferences } from "../src/lib/personalization";
import { defaultSettings } from "../src/lib/api";

describe("personalization compatibility", () => {
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
