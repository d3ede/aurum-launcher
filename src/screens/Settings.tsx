import { t, formatDecimal } from "../lib/i18n";
import { LanguagePicker } from "../components/LanguagePicker";
import { useState } from "react";
import {
  Sun,
  Moon,
  Monitor,
  FolderOpen,
  Cpu,
  Coffee,
  KeyRound,
  Check,
  ExternalLink,
  Save,
} from "lucide-react";
import { useApp } from "../context";
import { rpc, native } from "../lib/api";
import { Field } from "../components/ui";
import type { Settings as SettingsType } from "../types";
export function Settings() {
  const { data, run, operation, busy, notify } = useApp();
  const [draft, setDraft] = useState(data.settings);
  const [key, setKey] = useState("");
  const [javaStatus, setJavaStatus] = useState("");
  const [newPath, setNewPath] = useState("");
  const set = <K extends keyof SettingsType>(k: K, v: SettingsType[K]) =>
    setDraft((old) => ({ ...old, [k]: v }));
  const theme = async (theme: SettingsType["theme"]) => {
    set("theme", theme);
    if (native)
      await run(() =>
        rpc("saveSettings", { settings: { ...data.settings, theme } }),
      );
    else {
      localStorage.setItem("auren:theme", theme);
      document.documentElement.dataset.theme =
        theme === "system"
          ? matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme;
      notify(t("Тема сохранена"));
    }
  };
  return (
    <>
      <div className="page-heading">
        <h1>{t("Настройки")}</h1>
        <p>{t("Java, память, интерфейс и интеграции.")}</p>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => rpc("saveSettings", { settings: draft }),
            t("Настройки сохранены"),
          );
        }}
      >
        <LanguagePicker onChange={(language) => set("language", language)} />
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <Sun size={21} />
            </span>
            <div>
              <h2>{t("Внешний вид")}</h2>
              <p>{t("Светлая, тёмная или вместе с системой")}</p>
            </div>
          </div>
          <div className="theme-options">
            {(
              [
                ["light", t("Тёплый свет"), Sun],
                ["dark", t("Тихий вечер"), Moon],
                ["system", t("Системная тема"), Monitor],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                type="button"
                key={id}
                aria-pressed={draft.theme === id}
                className={`theme-option ${id} ${draft.theme === id ? "selected" : ""}`}
                onClick={() => void theme(id)}
              >
                <div className="theme-mini">
                  <span />
                  <div>
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <span>
                  <Icon size={15} />
                  {label}
                  {draft.theme === id && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
        </section>
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
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <KeyRound size={21} />
            </span>
            <div>
              <h2>{t("Интеграции")}</h2>
              <p>{t("Секреты хранятся в хранилище учётных данных ОС")}</p>
            </div>
          </div>
          <Field
            label={t("CurseForge API-ключ{{v1}}", {
              v1: data.curseforgeConfigured ? t(" \u00B7 подключён") : "",
            })}
            hint={t(
              "Официальный ключ для стороннего приложения. Значение не сохраняется в конфигурации и не возвращается интерфейсу.",
            )}
          >
            <div className="input-action">
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  data.curseforgeConfigured
                    ? t("Ключ сохранён в хранилище ОС")
                    : t("Вставьте API-ключ")
                }
              />
              <button
                type="button"
                className="button secondary"
                disabled={busy || !key.trim()}
                onClick={async () => {
                  const ok = await run(async () => {
                    await rpc("setCurseforgeKey", { key });
                    return true;
                  }, t("Ключ сохранён"));
                  if (ok) setKey("");
                }}
              >
                {t("Сохранить ключ")}
              </button>
            </div>
          </Field>
          <div className="button-row">
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void run(() =>
                  rpc("openUrl", {
                    url: "https://docs.curseforge.com/rest-api/",
                  }),
                )
              }
            >
              {t("Получить ключ ")}
              <ExternalLink size={14} />
            </button>
            {data.curseforgeConfigured && (
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  void run(
                    () => rpc("setCurseforgeKey", { key: "" }),
                    t("CurseForge отключён"),
                  )
                }
              >
                {t("Удалить ключ")}
              </button>
            )}
          </div>
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
        {t(
          "Aurum 0.3.1 · PolyForm Noncommercial 1.0.0",
        )}
      </p>
    </>
  );
}
