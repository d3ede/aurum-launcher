import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Coffee,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import { useApp } from "../context";
import { rpc } from "../lib/api";
import { t } from "../lib/i18n";

export function StorageFilesSettings({
  launcherDirectory,
}: {
  launcherDirectory?: string;
}) {
  const { data, run, operation, saveSettings, busy, notify } = useApp();
  const [newPath, setNewPath] = useState("");
  const movingBlocked =
    busy || !!newPath || !!data.running.length || !!data.hostingRunning?.length;
  return (
    <section
      className="storage-section storage-preferences storage-files-settings"
      aria-label={t("Файлы и версии")}
    >
      <div className="storage-preferences-heading">
        <span className="storage-preferences-icon">
          <FolderOpen size={21} />
        </span>
        <h2>{t("Где хранятся файлы")}</h2>
        <button
          type="button"
          className="button secondary"
          disabled={movingBlocked}
          title={t(
            "Данные будут скопированы в пустую папку. Исходная папка сохранится. После копирования нужен перезапуск.",
          )}
          onClick={async () => {
            const path = await operation((operationId) =>
              rpc("changeDataDirectory", { operationId }),
            );
            if (path) setNewPath(path);
          }}
        >
          <FolderOpen size={16} />
          {t("Изменить папку данных")}
        </button>
      </div>
      <div className="storage-location-list">
        <div className="storage-location-row">
          <span>{t("Игровые файлы")}</span>
          <code title={data.dataDir}>
            {data.dataDir || t("Путь доступен в desktop-приложении")}
          </code>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !!newPath}
            aria-label={t("Открыть игровые файлы")}
            onClick={() => void run(() => rpc("openFolder", {}))}
          >
            <FolderOpen size={16} />
            {t(" Открыть").trim()}
          </button>
        </div>
        {launcherDirectory && (
          <div className="storage-location-row storage-location-launcher">
            <span>{t("Лаунчер")}</span>
            <code title={launcherDirectory}>{launcherDirectory}</code>
          </div>
        )}
      </div>
      <label className="checkbox-label storage-snapshots">
        <input
          type="checkbox"
          checked={data.settings.showSnapshots}
          disabled={busy || !!newPath}
          onChange={(e) =>
            void saveSettings({
              ...data.settings,
              showSnapshots: e.target.checked,
            })
          }
        />
        <span>{t("Показывать снапшоты Minecraft")}</span>
      </label>
      {newPath && (
        <div className="dialog-note storage-relocation-result" role="status">
          <span>
            {t("Новая папка: ")}
            <code>{newPath}</code>
          </span>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() =>
              void rpc("restart", {}).catch((e) => notify(e.message, true))
            }
          >
            {t("Перезапустить Aurum")}
          </button>
        </div>
      )}
    </section>
  );
}

export function StorageJavaSettings({
  managedSize,
  optimizeDisabled,
  onOptimize,
}: {
  managedSize: string;
  optimizeDisabled: boolean;
  onOptimize: () => void;
}) {
  const { data, run, saveSettings, busy } = useApp();
  const [path, setPath] = useState(data.settings.javaPath);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{
    path: string;
    ok: boolean;
    text: string;
  } | null>(null);
  useEffect(() => setPath(data.settings.javaPath), [data.settings.javaPath]);
  const selected = path.trim();
  const dirty = selected !== data.settings.javaPath;
  function editPath(value: string) {
    setPath(value);
    setResult(null);
  }
  return (
    <section
      className="storage-section storage-preferences storage-java-settings"
      aria-label="Java"
    >
      <div className="storage-preferences-heading">
        <span className="storage-preferences-icon">
          <Coffee size={21} />
        </span>
        <h2>Java</h2>
        <span className="storage-java-size">
          {t("Java в Aurum")}
          <b>{managedSize}</b>
        </span>
      </div>
      <form
        className="storage-java-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !busy)
            void saveSettings({ ...data.settings, javaPath: selected });
        }}
      >
        <label htmlFor="storage-java-path">{t("Путь к Java")}</label>
        <div className="input-action">
          <input
            id="storage-java-path"
            value={path}
            disabled={busy}
            placeholder={t("Автоматический выбор Java")}
            onChange={(e) => editPath(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              const chosen = await run(() => rpc("chooseJava", {}));
              if (chosen) editPath(chosen);
            }}
          >
            <FolderOpen size={16} />
            {t(" Обзор").trim()}
          </button>
        </div>
        {(selected || dirty || result) && (
          <div className="storage-java-actions">
            {selected && (
              <button
                type="button"
                className="button secondary storage-java-check"
                disabled={busy || checking}
                onClick={async () => {
                  setChecking(true);
                  setResult(null);
                  try {
                    const version = await run(() =>
                      rpc("checkJava", { path: selected }),
                    );
                    setResult({
                      path: selected,
                      ok: version !== undefined,
                      text:
                        version !== undefined
                          ? t("Java {{v1}} — доступна", { v1: version })
                          : t("Проверка Java не пройдена"),
                    });
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                {checking ? (
                  <LoaderCircle size={16} className="storage-spinning" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                {checking ? t("Проверяем Java…") : t("Проверить Java")}
              </button>
            )}
            {selected && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  editPath("");
                  if (
                    data.settings.javaPath &&
                    !(await saveSettings({ ...data.settings, javaPath: "" }))
                  )
                    setPath(data.settings.javaPath);
                }}
              >
                <RotateCcw size={15} />
                {t("Автоматически")}
              </button>
            )}
            {dirty && (
              <button type="submit" className="button primary" disabled={busy}>
                <Save size={16} />
                {t("Сохранить")}
              </button>
            )}
            {result && result.path === selected && (
              <span
                role="status"
                className={`storage-java-result ${result.ok ? "is-valid" : "is-error"}`}
              >
                {result.ok ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <AlertCircle size={16} />
                )}
                {result.text}
              </span>
            )}
          </div>
        )}
      </form>
      <div className="storage-java-optimization">
        <h3>{t("Компактная Java")}</h3>
        <button
          type="button"
          className="button secondary"
          disabled={optimizeDisabled}
          onClick={onOptimize}
        >
          {t("Оптимизировать Java")}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
