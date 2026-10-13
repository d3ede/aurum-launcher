import { Download, RefreshCw, X } from "lucide-react";
import { native } from "../lib/api";
import { formatDecimal, t, useLocale } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import { useUpdater } from "../updater";
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

export function LauncherUpdateBanner() {
  const update = useUpdater();
  useLocale();
  if (!native || !update.version || update.dismissed) return null;
  const working =
    update.stage === "downloading" || update.stage === "installing";
  return (
    <section
      className="launcher-update-banner"
      aria-label={t("Обновления лаунчера")}
    >
      <div className="launcher-update-copy">
        <strong>
          {t("Доступен Aurum {{version}}", { version: update.version })}
        </strong>
        {working || update.error ? (
          <UpdateStatus />
        ) : (
          update.blocked && (
            <p>{t("Завершите игру и текущие действия перед обновлением.")}</p>
          )
        )}
      </div>
      <InstallButton />
      <button
        type="button"
        className="icon-button"
        aria-label={t("Позже")}
        disabled={working}
        onClick={update.dismiss}
      >
        <X size={17} />
      </button>
    </section>
  );
}
