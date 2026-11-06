import { t, formatDecimal } from "../lib/i18n";
import { LanguagePicker } from "../components/LanguagePicker";
import { LauncherUpdateSettings } from "../components/LauncherUpdate";
import { APP_VERSION } from "../lib/version";
import { useLayoutEffect, useState } from "react";
import {
  House,
  Palette,
  ArrowRight,
  Trash2,
  FolderOpen,
  Cpu,
  Coffee,
  Check,
  Save,
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
  if (settingsTab === "appearance") return <AppearanceSettings />;
  return (
    <div className="settings-page" data-settings-page={settingsTab}>
      <SettingsPageHeading
        title={settingsTab === "home" ? "Главная страница" : "Настройки"}
        description={
          settingsTab === "home"
            ? "Настройте содержимое и расположение блоков на главной."
            : "Java, память, интерфейс и интеграции."
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
  const { data, run, operation, busy, notify, saveSettings, openSettings } =
    useApp();
  const [draft, setDraft] = useState(data.settings);
  const [javaStatus, setJavaStatus] = useState("");
  const [newPath, setNewPath] = useState("");
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
          });
        }}
      >
        <LanguagePicker onChange={(language) => set("language", language)} />
        <LauncherUpdateSettings />
        <div className="settings-destinations" aria-label={t("Персонализация")}>
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
        </div>
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <Cpu size={21} />
            </span>
            <div>
              <h2>{t("Память и запуск")}</h2>
              <p>{t("Общие параметры для всех сборок")}</p>
            </div>
          </div>
          <Field
            label={t("Оперативная память \u00B7 {{v1}} ГБ", {
              v1: formatDecimal(draft.ramMb / 1024),
            })}
            hint={t(
              "Оставьте достаточно памяти для операционной системы. Для каждой сборки можно задать отдельное значение.",
            )}
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
          <Field
            label={t("Дополнительные JVM-аргументы")}
            hint={t(
              "Память и classpath Aurum задаёт сам. Оставьте поле пустым, если дополнительные параметры не нужны.",
            )}
          >
            <input
              value={draft.jvmArgs}
              onChange={(e) => set("jvmArgs", e.target.value)}
              placeholder="-XX:+UseG1GC"
            />
          </Field>
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <Coffee size={21} />
            </span>
            <div>
              <h2>Java</h2>
              <p>{t("Подходящий runtime устанавливается автоматически")}</p>
            </div>
          </div>
          <Field
            label={t("Собственная Java (необязательно)")}
            hint={t(
              "Пустое поле \u2014 автоматическая установка Eclipse Temurin. Для новых версий игры требуется новая Java.",
            )}
          >
            <div className="input-action">
              <input
                value={draft.javaPath}
                onChange={(e) => set("javaPath", e.target.value)}
                placeholder={t("Автоматический выбор Java")}
              />
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  const path = await run(() => rpc("chooseJava", {}));
                  if (path) set("javaPath", path);
                }}
              >
                <FolderOpen size={16} />
                {t(" Обзор")}
              </button>
            </div>
          </Field>
          <button
            type="button"
            className="text-button"
            disabled={busy || !draft.javaPath}
            onClick={async () => {
              const version = await run(() =>
                rpc("checkJava", { path: draft.javaPath }),
              );
              if (version)
                setJavaStatus(
                  t("Java {{v1}} \u2014 доступна", { v1: version }),
                );
            }}
          >
            {t("Проверить Java")}
          </button>
          {javaStatus && (
            <span className="inline-status">
              <Check size={15} />
              {javaStatus}
            </span>
          )}
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <FolderOpen size={21} />
            </span>
            <div>
              <h2>{t("Файлы и версии")}</h2>
              <p>{t("Миры и настройки хранятся отдельно для каждой сборки")}</p>
            </div>
          </div>
          <div className="data-path">
            <code>
              {data.dataDir || t("Путь доступен в desktop-приложении")}
            </code>
            <button
              type="button"
              className="button secondary"
              onClick={() => void run(() => rpc("openFolder", {}))}
            >
              <FolderOpen size={16} />
              {t(" Открыть")}
            </button>
          </div>
          <div className="field">
            <button
              type="button"
              className="text-button"
              disabled={busy || !!newPath}
              onClick={async () => {
                const path = await operation((operationId) =>
                  rpc("changeDataDirectory", { operationId }),
                );
                if (path) setNewPath(path);
              }}
            >
              {t("Изменить папку данных")}
            </button>
            <small>
              {t(
                "Данные будут скопированы в пустую папку. Исходная папка сохранится. После копирования нужен перезапуск.",
              )}
            </small>
            {newPath && (
              <div className="dialog-note">
                {t("Новая папка: ")}
                {newPath}
                <br />
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    void rpc("restart", {}).catch((e) =>
                      notify(e.message, true),
                    )
                  }
                >
                  {t("Перезапустить Aurum")}
                </button>
              </div>
            )}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.showSnapshots}
              onChange={(e) => set("showSnapshots", e.target.checked)}
            />
            <div>
              <b>{t("Показывать снапшоты Minecraft")}</b>
              <small>
                {t("Экспериментальные версии могут быть нестабильны.")}
              </small>
            </div>
          </label>
        </section>
        <div className="settings-save">
          <span>
            {t("Изменения параметров применятся при следующем запуске игры.")}
          </span>
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
