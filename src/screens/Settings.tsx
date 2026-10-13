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
      notify("Тема сохранена");
    }
  };
  return (
    <>
      <div className="page-heading">
        <h1>Настройки</h1>
        <p>Java, память, интерфейс и интеграции.</p>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => rpc("saveSettings", { settings: draft }),
            "Настройки сохранены",
          );
        }}
      >
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <Sun size={21} />
            </span>
            <div>
              <h2>Внешний вид</h2>
              <p>Светлая, тёмная или вместе с системой</p>
            </div>
          </div>
          <div className="theme-options">
            {(
              [
                ["light", "Тёплый свет", Sun],
                ["dark", "Тихий вечер", Moon],
                ["system", "Как в системе", Monitor],
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
              <h2>Память и запуск</h2>
              <p>Общие параметры для всех сборок</p>
            </div>
          </div>
          <Field
            label={`Оперативная память · ${(draft.ramMb / 1024).toFixed(1)} ГБ`}
            hint="Оставьте достаточно памяти для операционной системы. Для каждой сборки можно задать отдельное значение."
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
              <span>1 ГБ</span>
              <span>8 ГБ</span>
              <span>16 ГБ</span>
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Ширина окна игры">
              <input
                required
                type="number"
                min="320"
                max="7680"
                value={draft.resolutionWidth}
                onChange={(e) => set("resolutionWidth", Number(e.target.value))}
              />
            </Field>
            <Field label="Высота окна игры">
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
            label="Дополнительные JVM-аргументы"
            hint="Память и classpath Aurum задаёт сам. Оставьте поле пустым, если дополнительные параметры не нужны."
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
              <p>Подходящий runtime устанавливается автоматически</p>
            </div>
          </div>
          <Field
            label="Собственная Java (необязательно)"
            hint="Пустое поле — автоматическая установка Eclipse Temurin. Для новых версий игры требуется новая Java."
          >
            <div className="input-action">
              <input
                value={draft.javaPath}
                onChange={(e) => set("javaPath", e.target.value)}
                placeholder="Автоматический выбор Java"
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
                <FolderOpen size={16} /> Обзор
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
              if (version) setJavaStatus(`Java ${version} — доступна`);
            }}
          >
            Проверить Java
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
              <h2>Файлы и версии</h2>
              <p>Миры и настройки хранятся отдельно для каждой сборки</p>
            </div>
          </div>
          <div className="data-path">
            <code>{data.dataDir || "Путь доступен в desktop-приложении"}</code>
            <button
              type="button"
              className="button secondary"
              onClick={() => void run(() => rpc("openFolder", {}))}
            >
              <FolderOpen size={16} /> Открыть
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
              Изменить папку данных
            </button>
            <small>
              Данные будут скопированы в пустую папку. Исходная папка
              сохранится. После копирования нужен перезапуск.
            </small>
            {newPath && (
              <div className="dialog-note">
                Новая папка: {newPath}
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
                  Перезапустить Aurum
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
              <b>Показывать снапшоты Minecraft</b>
              <small>Экспериментальные версии могут быть нестабильны.</small>
            </div>
          </label>
        </section>
        <section className="settings-section">
          <div className="settings-title">
            <span>
              <KeyRound size={21} />
            </span>
            <div>
              <h2>Интеграции</h2>
              <p>Секреты хранятся в хранилище учётных данных ОС</p>
            </div>
          </div>
          <Field
            label="Microsoft OAuth Client ID"
            hint="Client ID вашего зарегистрированного public client приложения для личных Microsoft-аккаунтов. Также требуется разрешение Minecraft Services API."
          >
            <input
              value={draft.microsoftClientId}
              onChange={(e) => set("microsoftClientId", e.target.value.trim())}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </Field>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void run(() =>
                rpc("openUrl", {
                  url: "https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code",
                }),
              )
            }
          >
            Настройка Microsoft OAuth <ExternalLink size={14} />
          </button>
          <Field
            label={`CurseForge API-ключ${data.curseforgeConfigured ? " · подключён" : ""}`}
            hint="Официальный ключ для стороннего приложения. Значение не сохраняется в конфигурации и не возвращается интерфейсу."
          >
            <div className="input-action">
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  data.curseforgeConfigured
                    ? "Ключ сохранён в хранилище ОС"
                    : "Вставьте API-ключ"
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
                  }, "Ключ сохранён");
                  if (ok) setKey("");
                }}
              >
                Сохранить ключ
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
              Получить ключ <ExternalLink size={14} />
            </button>
            {data.curseforgeConfigured && (
              <button
                type="button"
                className="text-button danger"
                onClick={() =>
                  void run(
                    () => rpc("setCurseforgeKey", { key: "" }),
                    "CurseForge отключён",
                  )
                }
              >
                Удалить ключ
              </button>
            )}
          </div>
        </section>
        <div className="settings-save">
          <span>
            Изменения параметров применятся при следующем запуске игры.
          </span>
          <button className="button primary" disabled={busy}>
            <Save size={16} /> Сохранить настройки
          </button>
        </div>
      </form>
      <p className="page-footnote">
        Aurum 0.2.1 · Независимый проект. Окончательная лицензия ещё не выбрана.
      </p>
    </>
  );
}
