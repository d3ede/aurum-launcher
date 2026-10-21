import { Download, ExternalLink, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { Profile } from "../types";
import { Modal } from "./ui";

export function PackManualDownloads({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const { busy, run, notify, refresh } = useApp();
  const files = profile.manualDownloads || [];
  const [removeImported, setRemoveImported] = useState(false);
  const [scanError, setScanError] = useState("");
  const scanning = useRef(false);
  useEffect(() => {
    if (!native || !files.length || busy) return;
    let active = true;
    const scan = async () => {
      if (scanning.current) return;
      scanning.current = true;
      try {
        const added = await rpc("scanPackDownloads", {
          id: profile.id,
          removeImported,
        });
        if (added > 0) await refresh();
        if (active) setScanError("");
      } catch (error) {
        if (active) setScanError(String(error));
        // A previous file may have been imported before a later file failed.
        await refresh().catch(() => {});
      } finally {
        scanning.current = false;
      }
    };
    void scan();
    const timer = setInterval(() => void scan(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [profile.id, files.length, busy, removeImported, refresh]);
  return (
    <Modal
      title={t("Нужна ручная установка")}
      subtitle={profile.name}
      onClose={onClose}
      wide
    >
      <p className="dialog-note">
        {t(
          "Скачайте недостающие файлы по ссылкам. Пока это окно открыто, лаунчер проверяет папку «Загрузки» и добавляет файлы нужных версий в сборку. Файл из другой папки можно выбрать вручную.",
        )}
      </p>
      {!!files.length && (
        <label className="pack-download-cleanup">
          <input
            type="checkbox"
            checked={removeImported}
            onChange={(event) => setRemoveImported(event.target.checked)}
          />
          {t("Удалять найденные файлы из «Загрузок» после успешного импорта")}
        </label>
      )}
      {scanError && (
        <p className="dialog-note" role="status">
          {t("Не удалось проверить «Загрузки». Можно выбрать файл вручную.")}{" "}
          {scanError}
        </p>
      )}
      <div className="pack-manual-list">
        {files.map((file) => (
          <div className="pack-missing-file" key={file.path}>
            <div className="pack-manual-info">
              <b>{file.name}</b>
              <code>{file.path}</code>
              <small>
                {file.reason === "restricted"
                  ? t("Автор разрешает скачивание только с сайта")
                  : t("Не удалось скачать автоматически")}
              </small>
            </div>
            <div className="pack-manual-actions">
              <button
                className="button secondary"
                onClick={() =>
                  void rpc("openUrl", { url: file.url }).catch((error) =>
                    notify(String(error), true),
                  )
                }
              >
                <ExternalLink size={15} />
                {t("Страница файла")}
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  const added = await run(() =>
                    rpc("importPackManualFile", {
                      id: profile.id,
                      path: file.path,
                    }),
                  );
                  if (added) notify(t("Файл добавлен в сборку"));
                }}
              >
                <Download size={15} />
                {t("Выбрать скачанный файл")}
              </button>
            </div>
          </div>
        ))}
        {!files.length && (
          <p role="status">{t("Все недостающие файлы установлены")}</p>
        )}
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() =>
            void rpc("openFolder", { id: profile.id }).catch((error) =>
              notify(String(error), true),
            )
          }
        >
          <FolderOpen size={16} />
          {t("Папка сборки")}
        </button>
        <button className="button primary" disabled={busy} onClick={onClose}>
          {files.length ? t("Продолжить позже") : t("Закрыть")}
        </button>
      </div>
    </Modal>
  );
}

export function PackManualNotice({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!!profile.manualDownloads?.length && (
        <div className="pack-manual-notice">
          <span>
            {t("Нужно установить вручную: {{count}}", {
              count: profile.manualDownloads?.length || 0,
            })}
          </span>
          <button className="button secondary" onClick={() => setOpen(true)}>
            {t("Показать файлы")}
          </button>
        </div>
      )}
      {open && (
        <PackManualDownloads profile={profile} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
