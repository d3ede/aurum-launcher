import { useState } from "react";
import { APP_VERSION } from "../lib/version";
import {
  ArrowRight,
  Megaphone,
  Settings2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useApp } from "../context";
import { t } from "../lib/i18n";
import { Modal } from "./ui";

// Release highlights and features available in this build.
const release = {
  version: APP_VERSION,
  highlights: [
    {
      icon: Settings2,
      title: "Возврат к списку модов",
      text: "Страница мода закрывается без перезагрузки и сброса прокрутки.",
    },
    {
      icon: Settings2,
      title: "Aurum 0.4.0",
      text: "Поиск и установка из ATLauncher, FTB и Technic.",
      date: "15 октября 2026",
      dateTime: "2026-10-15",
    },
    {
      icon: UserRound,
      title: "Импорт скинов",
      text: "Все сохранённые скины Modrinth одной кнопкой.",
    },
    {
      icon: UserRound,
      title: "Диагностика входа",
      text: "Minecraft Services показывает причину отказа сервера.",
    },
    {
      icon: Megaphone,
      title: "Aurum 0.3.9",
      text: "Ярлыки автоматически ведут на новую версию.",
      date: "15 октября 2026",
      dateTime: "2026-10-15",
    },
  ],
  details: [
    "В этой сборке закрытие страницы установленного мода сохраняет позицию в списке и не запускает повторную загрузку. После установки контент обновляется в фоне.",
    "В Aurum 0.4.0: крупные иконки и плитки, золотые кнопки с анимацией установки. Нажмите «Установлено», чтобы переместить проект из выбранной сборки в корзину.",
    "В этой сборке: публичные каталоги ATLauncher, FTB и Technic, выбор версии и установка в отдельный профиль без входа. Для ATLauncher доступны необязательные моды и выбор файлов, скачанных с сайта автора.",
    "В меню источников используются оригинальные логотипы площадок. FTB полностью помещается в значок, ATLauncher отображается на прозрачном фоне.",
    "В этой сборке скины из библиотеки Modrinth можно импортировать одной кнопкой в разделе «Скины и плащи». Модели рук сохраняются, дубликаты пропускаются.",
    "В этой сборке при отказе Minecraft Services отображаются HTTP-статус, описание ошибки сервера и идентификатор запроса, если он доступен.",
    "При обновлении ярлыки Aurum на рабочем столе и в меню «Пуск» автоматически перенаправляются на установленную версию.",
    "При выборе диска установщик автоматически добавляет папку Aurum Launcher; выбранная папка сохраняется.",
    "В установщике: компактное окно без системной шапки, выбор папки и два отдельных ярлыка.",
    "Язык установщика выбирается по интерфейсу Windows; для неподдерживаемых языков используется английский.",
    "В этой сборке: компактный список модов, фильтры, сортировка и обновление всех совместимых проектов.",
    "В каталоге можно переключаться между списком и адаптивными плитками.",
    "Изображения проектов открываются в карусели и увеличиваются по клику.",
    "Источники каталога собраны в выпадающий список, категории переведены.",
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
            {release.highlights.map(
              ({ icon: Icon, title, text, date, dateTime }) => (
                <div className="home-release-item" key={title}>
                  <span className="home-release-icon">
                    <Icon size={22} strokeWidth={1.7} />
                  </span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(text)}</p>
                    {date && (
                      <time className="home-release-date" dateTime={dateTime}>
                        {t(date)}
                      </time>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      </aside>
      {notes && (
        <Modal
          className="home-release-modal"
          title={t("Изменения Aurum {{version}}", { version: release.version })}
          subtitle={t("Обновления лаунчера")}
          onClose={() => setNotes(false)}
        >
          <ul
            className="home-release-details"
            tabIndex={0}
            aria-label={t("Все изменения")}
          >
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
