import { describe, expect, it, vi } from "vitest";
import {
  launcherDefaults,
  launcherPreferences,
  parseLastPage,
} from "../src/lib/launcher-preferences";
import { LauncherWindowBehavior } from "../src/lib/launcher-window-behavior";

describe("launcher preferences", () => {
  it("keeps both sounds on and other options off for existing settings", () => {
    expect(launcherPreferences({})).toEqual({
      gameReadySound: true,
      notificationSound: true,
      minimizeOnLaunch: false,
      restoreOnExit: false,
      confirmBeforeClose: false,
      rememberLastPage: false,
      disableAnimations: false,
    });
    expect(
      parseLastPage('{"route":"settings","settingsTab":"storage"}'),
    ).toEqual({ route: "settings", settingsTab: "storage" });
    for (const saved of [null, "broken", '{"route":"invalid"}', "null"])
      expect(parseLastPage(saved)).toEqual({
        route: "home",
        settingsTab: "general",
      });
  });

  it("minimizes once per game and restores only after the last game exits", async () => {
    const window = {
      minimize: vi.fn(async () => {}),
      unminimize: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
    };
    const preferences = {
      ...launcherDefaults,
      minimizeOnLaunch: true,
      restoreOnExit: true,
    };
    const behavior = new LauncherWindowBehavior(window, () => preferences);
    await behavior.handle({ phase: "running", profileId: "one" });
    await behavior.handle({ phase: "running", profileId: "one" });
    await behavior.handle({ phase: "running", profileId: "two" });
    expect(window.minimize).toHaveBeenCalledTimes(2);
    await behavior.handle({ phase: "exited", profileId: "one" });
    expect(window.unminimize).not.toHaveBeenCalled();
    await behavior.handle({ phase: "crashed", profileId: "two" });
    await behavior.handle({ phase: "exited", profileId: "two" });
    expect(window.unminimize).toHaveBeenCalledTimes(1);
    expect(window.setFocus).toHaveBeenCalledTimes(1);
  });

  it("respects disabled options and handles games recovered after restart", async () => {
    const window = {
      minimize: vi.fn(async () => {}),
      unminimize: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
    };
    const preferences = { ...launcherDefaults };
    const behavior = new LauncherWindowBehavior(window, () => preferences);
    await behavior.handle({ phase: "running", profileId: "one" });
    await behavior.handle({ phase: "exited", profileId: "one" });
    expect(window.minimize).not.toHaveBeenCalled();
    expect(window.unminimize).not.toHaveBeenCalled();
    behavior.seed(["recovered"]);
    preferences.restoreOnExit = true;
    await behavior.handle({ phase: "exited", profileId: "recovered" });
    expect(window.unminimize).toHaveBeenCalledTimes(1);
  });
});
