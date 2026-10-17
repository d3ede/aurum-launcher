import { useState } from "react";
import { APP_VERSION } from "../lib/version";
import { ArrowRight, Settings2, UserPlus } from "lucide-react";
import { AccountAvatar } from "./AccountAvatar";
import { useApp } from "../context";
import { t } from "../lib/i18n";
import { Modal } from "./ui";

// Release highlights and features available in this build.
const release = {
  version: APP_VERSION,
  highlights: [
    {
      icon: Settings2,
      title: "Удобный выбор скина",
      text: "Список прокручивается отдельно, кнопка применения всегда видна.",
    },
    {
      icon: Settings2,
      title: `Aurum ${APP_VERSION}`,
      text: "Головы из скинов и подготовка окна Microsoft заранее.",
      date: "17 октября 2026",
      dateTime: "2026-10-17",
    },
    {
      icon: Settings2,
      title: "Сохранение входа Microsoft",
      text: "В этой сборке исправлена ошибка сохранения длинных сессий.",
    },
    {
      icon: Settings2,
      title: "Головы из скинов",
      text: "Ваш скин в шапке, на главной и в списке аккаунтов.",
    },
    {
      icon: Settings2,
      title: "Окно Microsoft",
      text: "Подготавливается в фоне и используется повторно.",
    },
  ],
  details: [
    "В этой сборке библиотека скинов прокручивается отдельно от персонажа. Предпросмотр подстраивается под высоту окна, а кнопки изменения и применения остаются на экране.",
    "В этой сборке вместо иконок аккаунтов отображаются головы из текущих скинов, включая верхний слой. Скины кэшируются для следующих запусков, а локальные профили показывают выбранный скин.",
    "В этой сборке окно входа Microsoft подготавливается в фоне после запуска Aurum и повторно используется при следующей попытке входа. Страница Microsoft загружается только после нажатия кнопки входа.",
    "В этой сборке исправлена ошибка сохранения сессии Microsoft из-за ограничения хранилища Windows. Существующие сохранённые сессии переносятся автоматически.",
    "В этой сборке исправлена загрузка изображений Imgur в описаниях проектов.",
    "В этой сборке галерея Modrinth загружает оригиналы вместо уменьшенных превью. Просмотр подстраивается под размер окна, область галереи стала выше.",
    "В этой сборке закрытие страницы установленного мода сохраняет позицию в списке и не запускает повторную загрузку. После установки контент обновляется в фоне.",
    "В этой сборке данные по умолчанию хранятся в Aurum Launcher, а папки профилей называются по имени сборки. Прежние данные переносятся автоматически; выбранная вручную папка данных сохраняется.",
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
