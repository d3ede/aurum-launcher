import { useState } from "react";
import {
  Bell,
  Volume2,
  Minimize2,
  Maximize2,
  LogOut,
  History,
  Sparkles,
  Settings2,
} from "lucide-react";
import { useApp } from "../context";
import { t } from "../lib/i18n";
import {
  launcherPreferences,
  type LauncherPreferences as Preferences,
} from "../lib/launcher-preferences";

const controls = [
  ["gameReadySound", "Звук готовности игры", Volume2],
  ["notificationSound", "Звук уведомлений лаунчера", Bell],
  ["minimizeOnLaunch", "Сворачивать при запуске игры", Minimize2],
  ["restoreOnExit", "Возвращать после выхода из игры", Maximize2],
  ["confirmBeforeClose", "Спрашивать перед закрытием", LogOut],
  ["rememberLastPage", "Запоминать последнюю страницу", History],
  ["disableAnimations", "Выключить все анимации", Sparkles],
] as const;

export function LauncherPreferencesSettings() {
  const { data, busy, saveSettings } = useApp();
  const [pending, setPending] = useState<Preferences | null>(null);
  const preferences = pending || launcherPreferences(data.settings);
  const toggle = async (key: keyof Preferences, checked: boolean) => {
    const next = { ...preferences, [key]: checked };
    setPending(next);
    try {
      await saveSettings({ ...data.settings, launcher: next }, true);
    } finally {
      setPending(null);
    }
  };
  return (
    <section
      className="settings-section launcher-preferences"
      aria-labelledby="launcher-preferences-title"
    >
      <div className="launcher-preferences-heading">
        <Settings2 size={19} aria-hidden="true" />
        <h2 id="launcher-preferences-title">{t("Поведение лаунчера")}</h2>
        <small>{t("Сохраняется автоматически")}</small>
      </div>
      <div className="launcher-preferences-grid">
        {controls.map(([key, label, Icon]) => (
          <label className="launcher-preference" key={key}>
            <Icon size={16} aria-hidden="true" />
            <span className="launcher-preference-name">{t(label)}</span>
            <span className="launcher-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={t(label)}
                checked={preferences[key]}
                disabled={busy || !!pending}
                onChange={(event) => void toggle(key, event.target.checked)}
              />
              <span className="launcher-switch-track" aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
