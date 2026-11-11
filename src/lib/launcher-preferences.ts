import type { Route, Settings } from "../types";
import type { SettingsTab } from "./personalization";

export interface LauncherPreferences {
  gameReadySound: boolean;
  notificationSound: boolean;
  minimizeOnLaunch: boolean;
  restoreOnExit: boolean;
  confirmBeforeClose: boolean;
  rememberLastPage: boolean;
  disableAnimations: boolean;
}

export const launcherDefaults: LauncherPreferences = {
  gameReadySound: true,
  notificationSound: true,
  minimizeOnLaunch: false,
  restoreOnExit: false,
  confirmBeforeClose: false,
  rememberLastPage: false,
  disableAnimations: false,
};

export function launcherPreferences(
  settings: Pick<Settings, "launcher">,
): LauncherPreferences {
  return { ...launcherDefaults, ...settings.launcher };
}

export const lastPageKey = "aurum:last-page";
export function parseLastPage(value: string | null): {
  route: Route;
  settingsTab: SettingsTab;
} {
  const fallback = {
    route: "home" as Route,
    settingsTab: "general" as SettingsTab,
  };
  try {
    const saved = JSON.parse(value || "null");
    if (
      !saved ||
      ![
        "home",
        "profiles",
        "catalog",
        "screenshots",
        "accounts",
        "skins",
        "hosting",
        "friends",
        "settings",
      ].includes(saved.route)
    )
      return fallback;
    return {
      route: saved.route,
      settingsTab: [
        "general",
        "home",
        "appearance",
        "game",
        "storage",
      ].includes(saved.settingsTab)
        ? saved.settingsTab
        : "general",
    };
  } catch {
    return fallback;
  }
}
