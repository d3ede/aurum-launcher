export const homeEnglish: Record<string, string> = {
  "Мой аккаунт": "My account",
  "Управление аккаунтом": "Manage account",
  "Открыть аккаунты": "Open accounts",
  "Выбрать аккаунт для игры": "Choose a game account",
  "Информация Aurum": "Aurum information",
  "Что нового": "What's new",
  "Все изменения Aurum": "All Aurum changes",
  "Все изменения": "All changes",
  "Показать все": "Show all",
  "Импорт сборок": "Instance import",
  "Обновление лаунчера без переустановки вручную.":
    "Update the launcher without reinstalling manually.",
  "14 октября 2026": "14 Oct 2026",
  "Профили, моды и миры из Modrinth.":
    "Profiles, mods and worlds from Modrinth.",
  "Библиотека образов и стандартные скины.": "Saved looks and default skins.",
  "Обновления в приложении": "In-app updates",
  "Проверка версий и установка с перезапуском.":
    "Check for releases, install and restart.",
  "Прогресс загрузки": "Download progress",
  "Объём скачивания и повтор при ошибке.":
    "Download size and retry after an error.",
  "Проверка обновлений": "Update verification",
  "Подпись пакета проверяется перед установкой.":
    "Package signatures are checked before installation.",
  "Изменения Aurum {{version}}": "Aurum {{version}} changes",
  "Лаунчер проверяет новые версии при запуске и каждые шесть часов.":
    "The launcher checks for new releases at startup and every six hours.",
  "Установку можно запустить из уведомления или настроек.":
    "Start installation from the notification or settings.",
  "Перед установкой проверяется подпись обновления.":
    "The update signature is verified before installation.",
  "Для установки нужно завершить игру и текущие действия.":
    "Close the game and finish current tasks before installing.",
  "Профили, аккаунты и игровые файлы сохраняются на своих местах.":
    "Profiles, accounts and game files keep their existing locations.",
  "Настройки обновлений": "Update settings",
  "Настройки сборки {{name}}": "Settings for {{name}}",
};
export const homeRussian = Object.fromEntries(
  Object.keys(homeEnglish).map((key) => [key, key]),
);
