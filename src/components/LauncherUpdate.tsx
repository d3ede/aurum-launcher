import { ArrowRight, Download, RefreshCw } from "lucide-react";
import { native } from "../lib/api";
import { formatDecimal, t, useLocale } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import { useUpdater } from "../updater";
import { Modal } from "./ui";
import { HomePattern } from "./TerrainPattern";
import aurumLogo from "../assets/branding/aurum-gold.svg";
import "../updater.css";

function UpdateStatus() {
  const update = useUpdater();
  useLocale();
  if (update.error)
    return (
      <p className="update-error" role="alert">
        {t(
          update.error === "check"
            ? "Не удалось проверить обновления. Попробуйте ещё раз."
            : "Не удалось загрузить или проверить обновление. Попробуйте ещё раз.",
        )}
      </p>
    );
  if (update.stage === "downloading" || update.stage === "installing")
    return (
      <div className="update-progress" aria-live="polite">
        <p>
          {t(
            update.stage === "installing"
              ? "Перезапускаем Aurum…"
              : "Загружаем обновление…",
          )}
        </p>
        <progress
          aria-label={t("Загружаем обновление…")}
          {...(update.total
            ? {
                max: update.total,
                value: Math.min(update.downloaded, update.total),
              }
            : {})}
        />
        {update.stage === "downloading" && (
          <small>
            {formatDecimal(update.downloaded / 1000000)} MB
            {update.total
              ? ` / ${formatDecimal(update.total / 1000000)} MB`
              : ""}
          </small>
        )}
      </div>
    );
  return (
    <p aria-live="polite">
      {t(
        update.stage === "checking"
          ? "Проверяем обновления…"
          : update.stage === "current"
            ? "Установлена последняя версия"
            : "Aurum проверяет новые версии при запуске и каждые 6 часов.",
      )}
    </p>
  );
}

function InstallButton() {
  const update = useUpdater();
  const working =
    update.stage === "downloading" || update.stage === "installing";
  return (
    <button
      type="button"
      className="button primary"
      disabled={update.blocked || working || update.stage === "checking"}
      onClick={() => void update.install()}
    >
      <Download size={16} />
      {t("Обновить и перезапустить")}
    </button>
  );
}

export function LauncherUpdateSettings() {
  const update = useUpdater();
  useLocale();
  const working = ["checking", "downloading", "installing"].includes(
    update.stage,
  );
  return (
    <section className="settings-section launcher-updates">
      <div className="settings-title">
        <span>
          <RefreshCw size={21} />
        </span>
        <div>
          <h2>{t("Обновления лаунчера")}</h2>
          <p>Aurum {APP_VERSION}</p>
        </div>
      </div>
      {native ? (
        <>
          {update.version && (
            <strong>
              {t("Доступен Aurum {{version}}", { version: update.version })}
            </strong>
          )}
          <UpdateStatus />
          {update.version && update.blocked && (
            <p>{t("Завершите игру и текущие действия перед обновлением.")}</p>
          )}
          <div className="button-row">
            {update.version && <InstallButton />}
            <button
              type="button"
              className="button secondary"
              disabled={working}
              onClick={() => void update.checkNow()}
            >
              <RefreshCw size={16} />
              {t("Проверить обновления")}
            </button>
          </div>
        </>
      ) : (
        <p>{t("Обновления доступны в desktop-приложении.")}</p>
      )}
    </section>
  );
}

export function LauncherUpdateDialog() {
  const update = useUpdater();
  useLocale();
  if (!native || !update.version || update.dismissed) return null;
  const working =
    update.stage === "downloading" || update.stage === "installing";
  return (
    <Modal
      title={t("Доступно обновление")}
      subtitle={t("Установить новую версию Aurum?")}
      className="launcher-update-dialog"
      onClose={update.dismiss}
      closeDisabled={working}
    >
      <div className="launcher-update-art" aria-hidden="true">
        <HomePattern />
      </div>
      <div className="launcher-update-release">
        <span className="launcher-update-symbol" aria-hidden="true">
          <img src={aurumLogo} alt="" />
          <span>
            <RefreshCw size={12} />
          </span>
        </span>
        <div>
          <strong>Aurum Launcher</strong>
          <span>
            {t("Доступен Aurum {{version}}", { version: update.version })}
          </span>
        </div>
      </div>
      <div className="launcher-update-versions">
        <div>
          <span>{t("Текущая версия")}</span>
          <b>{APP_VERSION}</b>
        </div>
        <ArrowRight size={20} aria-hidden="true" />
        <div>
          <span>{t("Новая версия")}</span>
          <b>{update.version}</b>
        </div>
      </div>
      <p className="launcher-update-restart-note">
        {t("После установки Aurum перезапустится.")}
      </p>
      {(working || update.error || update.stage === "checking") && (
        <UpdateStatus />
      )}
      {update.blocked && !working && (
        <p className="launcher-update-blocked" role="status">
          {t("Завершите игру и текущие действия перед обновлением.")}
        </p>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="button secondary"
          disabled={working}
          onClick={update.dismiss}
        >
          {t("Позже")}
        </button>
        <InstallButton />
      </div>
    </Modal>
  );
}
