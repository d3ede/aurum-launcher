import { StorageSettings } from "./Storage";
import { GameSettings } from "./GameSettings";
import { t, formatDecimal } from "../lib/i18n";
import { LanguagePicker } from "../components/LanguagePicker";
import { LauncherUpdateSettings } from "../components/LauncherUpdate";
import { LauncherPreferencesSettings } from "../components/LauncherPreferences";
import { APP_VERSION } from "../lib/version";
import { useLayoutEffect, useState } from "react";
import {
  House,
  Palette,
  ArrowRight,
  Trash2,
  Cpu,
  HardDrive,
  Save,
  Gamepad2,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { Field } from "../components/ui";
import type { Settings as SettingsType } from "../types";
import { HomeSettings, AppearanceSettings } from "./Personalization";
import {
  SettingsPageHeading,
  scrollSettingsToTop,
} from "../components/SettingsPageHeading";

export function Settings() {
  const { settingsTab, openSettings } = useApp();
  useLayoutEffect(scrollSettingsToTop, [settingsTab]);
  if (settingsTab === "game") return <GameSettings />;
  if (settingsTab === "storage") return <StorageSettings />;
  if (settingsTab === "appearance") return <AppearanceSettings />;
  return (
    <div className="settings-page" data-settings-page={settingsTab}>
      <SettingsPageHeading
        title={settingsTab === "home" ? "Главная страница" : "Настройки"}
        description={
          settingsTab === "home"
            ? "Настройте содержимое и расположение блоков на главной."
            : undefined
        }
        onBack={
          settingsTab === "home" ? () => openSettings("general") : undefined
        }
      />
      {settingsTab === "home" ? <HomeSettings /> : <GeneralSettings />}
    </div>
  );
}
function GeneralSettings() {
  const { data, run, busy, saveSettings, openSettings } = useApp();
  const [draft, setDraft] = useState(data.settings);
  const set = <K extends keyof SettingsType>(k: K, v: SettingsType[K]) =>
    setDraft((old) => ({ ...old, [k]: v }));
  return (
    <>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void saveSettings({
            ...data.settings,
            ...draft,
            personalization: data.settings.personalization,
            theme: data.settings.theme,
            launcher: data.settings.launcher,
          });
        }}
      >
        <LanguagePicker onChange={(language) => set("language", language)} />
        <LauncherUpdateSettings />
        <div className="settings-destinations" aria-label={t("Персонализация")}>
          <button
            type="button"
            className="settings-destination"
            aria-label={t("@game.title")}
            onClick={() => openSettings("game")}
          >
            <span className="settings-destination-icon">
              <Gamepad2 size={25} />
            </span>
            <span>
              <b>{t("@game.title")}</b>
              <small>{t("@game.destination")}</small>
            </span>
            <ArrowRight size={19} />
          </button>
          <button
            type="button"
            className="settings-destination"
            aria-label={t("Главная страница")}
            onClick={() => openSettings("home")}
          >
            <span className="settings-destination-icon">
              <House size={25} />
            </span>
            <span>
              <b>{t("Главная страница")}</b>
              <small>{t("Блоки, быстрый запуск и свой фон")}</small>
            </span>
            <ArrowRight size={19} />
          </button>
          <button
            type="button"
            className="settings-destination"
            aria-label={t("Внешний вид")}
            onClick={() => openSettings("appearance")}
          >
            <span className="settings-destination-icon">
              <Palette size={25} />
            </span>
            <span>
              <b>{t("Внешний вид")}</b>
              <small>{t("Темы, свои цвета и шрифт")}</small>
            </span>
            <ArrowRight size={19} />
          </button>
          <button
            type="button"
            className="settings-destination"
            onClick={() => openSettings("storage")}
          >
            <span className="settings-destination-icon">
              <HardDrive size={25} />
            </span>
            <span>
              <b>{t("Хранилище")}</b>
              <small>{t("Файлы, версии и Java")}</small>
            </span>
            <ArrowRight size={19} />
          </button>
        </div>
        <LauncherPreferencesSettings />
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <Cpu size={21} />
            </span>
            <div>
              <h2>{t("Память и запуск")}</h2>
            </div>
          </div>
          <Field
            label={t("Оперативная память \u00B7 {{v1}} ГБ", {
              v1: formatDecimal(draft.ramMb / 1024),
            })}
          >
            <input
              type="range"
              min="1024"
              max="16384"
              step="512"
              value={draft.ramMb}
              onChange={(e) => set("ramMb", Number(e.target.value))}
            />
            <div className="range-labels">
              <span>{t("1 ГБ")}</span>
              <span>{t("8 ГБ")}</span>
              <span>{t("16 ГБ")}</span>
            </div>
          </Field>
          <div className="form-grid">
            <Field label={t("Ширина окна игры")}>
              <input
                required
                type="number"
                min="320"
                max="7680"
                value={draft.resolutionWidth}
                onChange={(e) => set("resolutionWidth", Number(e.target.value))}
              />
            </Field>
            <Field label={t("Высота окна игры")}>
              <input
                required
                type="number"
                min="240"
                max="4320"
                value={draft.resolutionHeight}
                onChange={(e) =>
                  set("resolutionHeight", Number(e.target.value))
                }
              />
            </Field>
          </div>
          <Field label={t("Дополнительные JVM-аргументы")}>
            <input
              value={draft.jvmArgs}
              onChange={(e) => set("jvmArgs", e.target.value)}
              placeholder="-XX:+UseG1GC"
            />
          </Field>
        </section>
        <div className="settings-save">
          <button className="button primary" disabled={busy}>
            <Save size={16} />
            {t(" Сохранить настройки")}
          </button>
        </div>
      </form>
      <p className="page-footnote">
        Aurum {APP_VERSION} · PolyForm Noncommercial 1.0.0
      </p>
      <section className="settings-uninstall">
        <div>
          <h2>{t("Удаление приложения")}</h2>
          <p>
            {t(
              "Откроется деинсталлятор. Удаление сборок, миров и остальных данных выбирается отдельно.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="button uninstall-button"
          disabled={busy}
          onClick={() => void run(() => rpc("uninstall", {}))}
        >
          <Trash2 size={17} />
          {t("Удалить Aurum")}
        </button>
      </section>
    </>
  );
}
