export const homeEnglish: Record<string, string> = {
  "Папка установки": "Installation folder",
  "Локальное исправление: своя папка при выборе диска.":
    "Local fix: a dedicated folder when selecting a drive.",
  "Локальное исправление установщика: при выборе диска автоматически добавляется папка Aurum Launcher; выбранная папка сохраняется.":
    "Local installer fix: selecting a drive adds an Aurum Launcher folder; an explicitly chosen folder keeps its location.",
  "Обновлены главная, каталог и установщик.":
    "Updated home, catalog and installer.",
  "Новый установщик": "New installer",
  "Локальная сборка: папка, ярлыки и язык Windows.":
    "Local build: folder, shortcuts and Windows language.",
  "В установщике: компактное окно без системной шапки, выбор папки и два отдельных ярлыка.":
    "The installer has a compact window without a system title bar, folder selection and two separate shortcuts.",
  "Язык установщика выбирается по интерфейсу Windows; для неподдерживаемых языков используется английский.":
    "The installer follows the Windows display language and uses English for unsupported languages.",
  "Управление модами": "Mod management",
  "Фильтры, версии и обновление всех модов.":
    "Filters, versions and update all mods.",
  "В этой сборке: компактный список модов, фильтры, сортировка и обновление всех совместимых проектов.":
    "In this build: compact mod rows, filters, sorting and compatible bulk updates.",
  "Виды каталога": "Catalog views",
  "Список и плитки, карусель и увеличение изображений.":
    "List and grid views, an image carousel and zoom.",
  "В каталоге можно переключаться между списком и адаптивными плитками.":
    "Switch the catalog between list and responsive grid views.",
  "Изображения проектов открываются в карусели и увеличиваются по клику.":
    "Browse project images in a carousel and click to enlarge them.",
  "Источники каталога собраны в выпадающий список, категории переведены.":
    "Catalog sources use a dropdown, and categories have translated labels.",
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
