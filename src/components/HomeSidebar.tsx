import { useState } from "react";
import {
  ArrowRight,
  Box,
  Megaphone,
  Settings2,
  Shirt,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useApp } from "../context";
import { t } from "../lib/i18n";
import { Modal } from "./ui";

// Published release plus features available in this build; dates only for published releases.
const release = {
  version: "0.3.3",
  highlights: [
    {
      icon: Megaphone,
      title: "Aurum 0.3.3",
      text: "Обновление лаунчера без переустановки вручную.",
      date: "14 октября 2026",
    },
    {
      icon: Box,
      title: "Импорт сборок",
      text: "Профили, моды и миры из Modrinth.",
    },
    {
      icon: Shirt,
      title: "Скины и плащи",
      text: "Библиотека образов и стандартные скины.",
    },
  ],
  details: [
    "Лаунчер проверяет новые версии при запуске и каждые шесть часов.",
    "Установку можно запустить из уведомления или настроек.",
    "Перед установкой проверяется подпись обновления.",
    "Для установки нужно завершить игру и текущие действия.",
    "Профили, аккаунты и игровые файлы сохраняются на своих местах.",
  ],
};

export function HomeSidebar() {
  const { data, navigate } = useApp();
  const [notes, setNotes] = useState(false);
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
              {account ? <UserRound size={31} /> : <UserPlus size={29} />}
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
              onClick={() => setNotes(true)}
              aria-label={t("Все изменения")}
            >
              {t("Показать все")}
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="home-release-list">
            {release.highlights.map(({ icon: Icon, title, text, date }) => (
              <div className="home-release-item" key={title}>
                <span className="home-release-icon">
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <div>
                  <h3>{t(title)}</h3>
                  <p>{t(text)}</p>
                  {date && (
                    <time className="home-release-date" dateTime="2026-10-14">
                      {t(date)}
                    </time>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
      {notes && (
        <Modal
          title={t("Изменения Aurum {{version}}", { version: release.version })}
          subtitle={t("Обновления лаунчера")}
          onClose={() => setNotes(false)}
        >
          <ul className="home-release-details">
            {release.details.map((detail) => (
              <li key={detail}>{t(detail)}</li>
            ))}
          </ul>
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
