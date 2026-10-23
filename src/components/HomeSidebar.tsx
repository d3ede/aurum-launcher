import { useState } from "react";
import { APP_VERSION } from "../lib/version";
import { ArrowRight, ChevronDown, Settings2, UserPlus } from "lucide-react";
import { AccountAvatar } from "./AccountAvatar";
import { useApp } from "../context";
import { getLocale, t } from "../lib/i18n";
import { Modal } from "./ui";

import { releaseNotes } from "../lib/release-notes";

function releaseDate(date: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date + "T12:00:00"));
}

export function HomeSidebar() {
  const { data, navigate } = useApp();
  const [notes, setNotes] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(APP_VERSION);
  const account = data.accounts.find(
    (item) => item.id === data.selectedAccount,
  );
  return (
    <>
      <aside className="home-sidebar" aria-label={t("Информация Aurum")}>
        <section className="home-account-card">
          <div className="home-card-heading">
            <h2>{t("Мой аккаунт")}</h2>
            <button
              className="icon-button"
              aria-label={t("Управление аккаунтом")}
              onClick={() => navigate("accounts")}
            >
              <Settings2 size={17} />
            </button>
          </div>
          <button
            className="home-account-identity"
            onClick={() => navigate("accounts")}
            aria-label={t("Открыть аккаунты")}
          >
            <span className="home-account-avatar">
              {account ? (
                <AccountAvatar account={account} size={40} />
              ) : (
                <UserPlus size={29} />
              )}
            </span>
            <span className="home-account-info">
              <b>{account?.name || t("Добавить аккаунт")}</b>
              {account ? (
                <span
                  className={`home-account-kind ${account.kind === "microsoft" ? "microsoft" : ""}`}
                >
                  <i aria-hidden="true" />
                  {account.kind === "microsoft" ? "Microsoft" : t("Локальный")}
                </span>
              ) : (
                <small>{t("Выбрать аккаунт для игры")}</small>
              )}
            </span>
            <ArrowRight size={16} />
          </button>
        </section>
        <section className="home-news-card">
          <div className="home-card-heading">
            <h2>{t("Что нового")}</h2>
            <button
              className="text-button"
              onClick={() => {
                setSelectedVersion(APP_VERSION);
                setNotes(true);
              }}
              aria-label={t("Все изменения")}
            >
              {t("Показать все")}
              <ArrowRight size={14} />
            </button>
          </div>
          <div
            className="home-release-list"
            tabIndex={0}
            aria-label={t("Новости лаунчера")}
          >
            {releaseNotes.slice(0, 3).map((release) => (
              <article className="home-news-version" key={release.version}>
                <div className="home-news-version-head">
                  <span className="release-version">
                    Aurum {release.version}
                  </span>
                  {release.version === APP_VERSION && (
                    <span className="release-current">
                      {t("Текущая версия")}
                    </span>
                  )}
                </div>
                {release.date && (
                  <time className="home-release-date" dateTime={release.date}>
                    {releaseDate(release.date)}
                  </time>
                )}
                <h3>{t(release.title)}</h3>
                <ul>
                  {release.groups.map((group) => (
                    <li key={group.title}>{t(group.items[0])}</li>
                  ))}
                </ul>
                <button
                  className="text-button home-news-more"
                  aria-label={t("Подробнее о версии {{version}}", {
                    version: release.version,
                  })}
                  onClick={() => {
                    setSelectedVersion(release.version);
                    setNotes(true);
                  }}
                >
                  {t("Подробнее")}
                  <ArrowRight size={13} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </aside>
      {notes && (
        <Modal
          className="home-release-modal"
          title={t("История версий")}
          subtitle={t("Обновления лаунчера")}
          onClose={() => setNotes(false)}
        >
          <div
            className="home-release-details"
            tabIndex={0}
            aria-label={t("Все изменения")}
          >
            {releaseNotes.map((release) => (
              <details
                className="release-section"
                key={release.version}
                open={release.version === selectedVersion}
              >
                <summary>
                  <div className="release-section-heading">
                    <span className="release-section-version">
                      Aurum {release.version}
                    </span>
                    {release.version === APP_VERSION && (
                      <span className="release-current">
                        {t("Текущая версия")}
                      </span>
                    )}
                    {release.date && (
                      <time dateTime={release.date}>
                        {releaseDate(release.date)}
                      </time>
                    )}
                    <strong>{t(release.title)}</strong>
                  </div>
                  <ChevronDown size={18} className="release-chevron" />
                </summary>
                <div className="release-section-body">
                  {release.groups.map((group) => (
                    <section key={group.title}>
                      <h4>{t(group.title)}</h4>
                      <ul>
                        {group.items.map((item) => (
                          <li key={item}>{t(item)}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setNotes(false)}
            >
              {t("Закрыть")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                setNotes(false);
                navigate("settings");
                requestAnimationFrame(() =>
                  document
                    .querySelector(".launcher-updates")
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
            >
              <Settings2 size={16} />
              {t("Настройки обновлений")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
