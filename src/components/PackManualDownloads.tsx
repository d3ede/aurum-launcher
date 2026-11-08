import {
  Download,
  ExternalLink,
  FolderOpen,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { native, rpc } from "../lib/api";
import { t } from "../lib/i18n";
import type { Profile } from "../types";
import { Modal } from "./ui";
import "./PackManualDownloads.css";
type Replacement = {
  path: string;
  name: string;
  sourcePath: string;
  fileName: string;
  sha256: string;
  destination: string;
};

export function PackManualDownloads({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const { busy, run, notify, refresh } = useApp();
  const files = profile.manualDownloads || [];
  const [removeImported, setRemoveImported] = useState(
    () => localStorage.getItem("aurum:move-pack-downloads") !== "false",
  );
  const [scanError, setScanError] = useState("");
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const scanning = useRef(false);
  useEffect(() => {
    if (!native || !files.length || busy || replacement) return;
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
  }, [profile.id, files.length, busy, removeImported, refresh, replacement]);
  useEffect(() => {
    if (replacement && !files.some((f) => f.path === replacement.path))
      setReplacement(null);
  }, [files, replacement]);
  return (
    <Modal
      title={t(
        files.length ? "Нужна ручная установка" : "@manual.completeTitle",
      )}
      subtitle={profile.name}
      onClose={onClose}
      wide
      className="pack-manual-modal"
    >
      <div className="pack-manual-body">
        {!!files.length && (
          <p className="dialog-note">
            {t(
              "Скачайте недостающие файлы по ссылкам. Лаунчер проверяет «Загрузки» и файлы в сборке по контрольной сумме, даже если имя изменено. Файл из другой папки можно выбрать вручную.",
            )}
          </p>
        )}
        {!!files.length && (
          <label className="pack-download-cleanup">
            <input
              type="checkbox"
              checked={removeImported}
              onChange={(event) => {
                setRemoveImported(event.target.checked);
                localStorage.setItem(
                  "aurum:move-pack-downloads",
                  String(event.target.checked),
                );
              }}
            />
            {t("Переносить скачанные файлы в сборку после проверки")}
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
                  {file.reason === "local"
                    ? t("@social.local.file")
                    : file.reason === "restricted"
                      ? t("Автор разрешает скачивание только с сайта")
                      : t("Не удалось скачать автоматически")}
                </small>
              </div>
              <div className="pack-manual-actions">
                <button
                  className="button secondary"
                  disabled={!file.url}
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
                        removeImported,
                      }),
                    );
                    if (added && typeof added === "object")
                      setReplacement({
                        ...added,
                        path: file.path,
                        name: file.name,
                      });
                    else if (added) notify(t("Файл добавлен в сборку"));
                  }}
                >
                  <Download size={15} />
                  {t("Выбрать скачанный файл")}
                </button>
              </div>
            </div>
          ))}
          {!files.length && (
            <div className="pack-manual-complete" role="status">
              <span>
                <CircleCheck size={30} />
              </span>
              <h3>{t("Все недостающие файлы установлены")}</h3>
              <p>{t("@manual.completeText")}</p>
            </div>
          )}
        </div>
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
      {replacement && (
        <Modal
          title={t("@manual.replaceTitle")}
          subtitle={replacement.name}
          onClose={() => setReplacement(null)}
          closeDisabled={busy}
          className="pack-replacement-modal"
        >
          <div className="pack-replacement-warning">
            <TriangleAlert size={22} />
            <p>{t("@manual.replaceWarning")}</p>
          </div>
          <dl className="pack-replacement-info">
            <dt>{t("@manual.selected")}</dt>
            <dd>{replacement.fileName}</dd>
            <dt>{t("@manual.destination")}</dt>
            <dd>
              <code>{replacement.destination}</code>
            </dd>
          </dl>
          <p className="dialog-note">{t("@manual.replaceHint")}</p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setReplacement(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button primary"
              disabled={busy || !files.some((f) => f.path === replacement.path)}
              onClick={async () => {
                const added = await run(() =>
                  rpc("importPackManualFile", {
                    id: profile.id,
                    path: replacement.path,
                    sourcePath: replacement.sourcePath,
                    confirmedSha256: replacement.sha256,
                    removeImported,
                  }),
                );
                if (added === true) {
                  setReplacement(null);
                  notify(t("Файл добавлен в сборку"));
                }
              }}
            >
              {t("@manual.useFile")}
            </button>
          </div>
        </Modal>
      )}
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
