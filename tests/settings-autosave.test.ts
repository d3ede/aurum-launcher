import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAutosave } from "../src/lib/settings-autosave";
import { defaultSettings } from "../src/lib/api";
import { launcherDefaults } from "../src/lib/launcher-preferences";
import type { Settings } from "../src/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("settings autosave", () => {
  it("coalesces typing and merges fields with the latest theme and switches", async () => {
    let current = { ...defaultSettings };
    const save = vi.fn(async (settings: Settings) => {
      current = settings;
      return true;
    });
    const autosave = new SettingsAutosave(
      () => current,
      () => true,
      save,
    );
    autosave.update({ resolutionWidth: 1600 });
    autosave.update({ resolutionWidth: 1920, resolutionHeight: 1080 });
    current = {
      ...current,
      theme: "dark",
      launcher: { ...launcherDefaults, minimizeOnLaunch: true },
    };
    await vi.advanceTimersByTimeAsync(449);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(current).toMatchObject({
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      theme: "dark",
      launcher: { minimizeOnLaunch: true },
    });
    autosave.update({ resolutionWidth: 1920 });
    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it("waits for other operations and saves later edits after an in-flight write", async () => {
    let current = { ...defaultSettings };
    let busy = true;
    let finish!: () => void;
    const save = vi.fn(async (settings: Settings) => {
      if (save.mock.calls.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      current = settings;
      return true;
    });
    const autosave = new SettingsAutosave(
      () => current,
      () => !busy,
      save,
    );
    autosave.update({ ramMb: 8192 });
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    busy = false;
    autosave.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    autosave.update({ resolutionWidth: 1920 });
    await autosave.flush();
    finish();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(current).toMatchObject({ ramMb: 8192, resolutionWidth: 1920 });
    autosave.stop();
  });

  it("retains a failed write for retry without repeatedly issuing failing requests", async () => {
    let current = { ...defaultSettings };
    const save = vi.fn(async (settings: Settings) => {
      if (save.mock.calls.length === 1) return false;
      current = settings;
      return true;
    });
    const autosave = new SettingsAutosave(
      () => current,
      () => true,
      save,
    );
    autosave.update({ jvmArgs: "-Dexample=first" });
    await vi.runAllTimersAsync();
    autosave.resume();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    autosave.update({ jvmArgs: "-Dexample=second" });
    await autosave.flush();
    expect(current.jvmArgs).toBe("-Dexample=second");
    expect(save).toHaveBeenCalledTimes(2);
    autosave.stop();
  });
});
