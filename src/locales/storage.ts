export const storageEnglish: Record<string, string> = {
  "Импорт создаёт копию, а не переносит сборку. Оригинал останется на диске и продолжит занимать место.":
    "Import creates a copy, not a move. The original stays on disk and continues to take up space.",
  "После успешной проверки копии отправить оригинал в корзину Windows":
    "After verifying the copy, send the original to the Windows Recycle Bin",
  "Галочка выключена по умолчанию. При ошибке или отмене оригинал сохраняется. Место освободится после очистки корзины Windows.":
    "Off by default. The original is kept on failure or cancellation. Empty the Windows Recycle Bin to reclaim disk space.",
  "Оригиналы в корзине Windows: {{v1}}":
    "Originals in the Windows Recycle Bin: {{v1}}",
  "Копирование сборок…": "Copying instances…",
  "Игровые файлы, Java и сборки занимают дополнительное место сверх размера самого приложения. Установочные архивы Java удаляются после проверки рабочей среды; игровые данные сохраняются.":
    "Game files, Java and instances take additional disk space beyond the application itself. Java installation archives are removed after validating the runtime; game data is preserved.",
  "Удалить Aurum": "Uninstall Aurum",
  "Откроется деинсталлятор. Удаление сборок, миров и остальных данных выбирается отдельно.":
    "The uninstaller will open. Removing instances, worlds and other data is a separate choice.",
  "Minecraft и Java используются повторно, если совместимая версия уже установлена. Остальные файлы скачаются при необходимости.":
    "Minecraft and Java are reused when a compatible version is already installed. Other files are downloaded as needed.",
  "Место на диске и удаление": "Disk space and uninstall",
  "Проверенная Java без архивов, явное копирование сборок и выбор данных при удалении.":
    "Validated Java without leftover archives, explicit instance copying and optional data removal.",
  "В этой тестовой сборке: Java нужной основной версии используется повторно, а её ZIP удаляется только после проверки рабочей среды. Импорт объясняет дополнительное место и предлагает отдельную выключенную галочку отправки оригинала в корзину Windows после проверки копии. Деинсталлятор доступен из настроек, Пуска и списка приложений Windows; игровые данные удаляются только по отдельному выбору.":
    "In this test build: Java with the required major version is reused, and its ZIP is removed only after validating the runtime. Import explains the extra disk space and offers a separate unchecked option to recycle the original after verifying the copy. The uninstaller is available from Settings, Start and Windows installed apps; game data is removed only by a separate choice.",
};
Object.assign(storageEnglish, {
  Хранилище: "Storage",
  "Занятое место, очистка и корзина": "Disk usage, cleanup and trash",
  "Всё, что занимает место: от миров до временных файлов.":
    "Everything on disk, from worlds to temporary files.",
  "Занятое место": "Disk usage",
  "Занято Aurum": "Used by Aurum",
  "Можно очистить": "Available to clean",
  "Кэш, загрузки, журналы и корзина": "Cache, downloads, logs and trash",
  "Пересчитать размер": "Recalculate disk usage",
  "Распределение занятого места": "Disk usage by category",
  "Сборки и миры": "Instances and worlds",
  "Общие файлы Minecraft": "Shared Minecraft files",
  "Локальные серверы": "Local servers",
  "Временные загрузки": "Temporary downloads",
  Корзина: "Trash",
  Кэш: "Cache",
  Журналы: "Logs",
  Лаунчер: "Launcher",
  "Остальные файлы": "Other files",
  "Ресурсы и библиотеки используются сразу несколькими сборками.":
    "Assets and libraries are shared by multiple instances.",
  "Нужная версия используется повторно. Новые загрузки содержат только среду запуска.":
    "Compatible versions are reused. New downloads include only the runtime.",
  "Клиент и подготовленные ресурсы Horizon.":
    "The Horizon client and prepared resources.",
  "Ненужные архивы установок и остатки прерванных загрузок.":
    "Unneeded installation archives and interrupted downloads.",
  "Восстанавливаемые данные. Кэш интерфейса очищается при перезапуске.":
    "Rebuildable data. Interface caches are cleared when you restart.",
  "Диагностика установок. Очистка не затрагивает миры и настройки.":
    "Installation diagnostics. Cleanup preserves worlds and settings.",
  Б: "B",
  КиБ: "KiB",
  МиБ: "MiB",
  ГиБ: "GiB",
  ТиБ: "TiB",
  "Не удалось прочитать хранилище": "Could not read storage",
  "Освобождено: {{v1}}": "Freed: {{v1}}",
  "Файлы восстановлены": "Files restored",
  "Удалить из корзины навсегда?": "Permanently delete from trash?",
  "Выбранные файлы и миры будут удалены без возможности восстановления. Элементов: {{v1}}":
    "Selected files and worlds will be permanently deleted. Items: {{v1}}",
  "Считаем файлы…": "Calculating disk usage…",
  Очистка: "Cleanup",
  "Освободите место, сохранив сборки, миры и аккаунты.":
    "Free up space while keeping instances, worlds and accounts.",
  Очистить: "Clean",
  "Очистка кэша интерфейса запланирована. Настройки и входы сохранятся.":
    "Interface cache cleanup is scheduled. Settings and sign-ins will be preserved.",
  "Компактная Java": "Compact Java",
  "Замените полные JDK на среду запуска без инструментов разработчика. Нужные версии сохранятся.":
    "Replace full JDKs with runtimes without developer tools. Required versions are kept.",
  "Оптимизировать Java": "Optimize Java",
  "Оптимизировать Java?": "Optimize Java?",
  "Aurum скачает компактные среды запуска и проверит их перед заменой. Указанная вручную Java останется без изменений.":
    "Aurum will download compact runtimes and verify them before replacing JDKs. Manually configured Java is preserved.",
  "Удалённые сборки сначала попадают в корзину Aurum.":
    "Deleted instances first go to Aurum's trash.",
  "Открыть папку {{v1}}": "Open {{v1}} folder",
  "Переместить сборку в корзину?": "Move instance to trash?",
  "В корзину": "Move to trash",
  "Сборок пока нет": "No instances yet",
  "Восстановите удалённое или освободите место навсегда.":
    "Restore deleted items or permanently free up space.",
  "Восстановить выбранное": "Restore selected",
  "Удалить выбранное навсегда": "Permanently delete selected",
  "Выбрать {{v1}}": "Select {{v1}}",
  "Старый элемент без данных восстановления":
    "Legacy item without recovery metadata",
  "Восстановить {{v1}}": "Restore {{v1}}",
  "Удалить {{v1}} навсегда": "Permanently delete {{v1}}",
  "Восстановить всё": "Restore all",
  "Очистить корзину": "Empty trash",
  "Корзина пуста": "Trash is empty",
  "Здесь появятся удалённые сборки, моды и ресурспаки.":
    "Deleted instances, mods and resource packs will appear here.",
  "Где хранятся файлы": "File locations",
  "Лаунчер и игровые данные разделены. Общие ресурсы не дублируются для каждой сборки.":
    "Launcher and game data are separate. Shared resources are reused between instances.",
  "Игровые файлы": "Game files",
  Продолжить: "Continue",
  "Подтвердите вход в обычном браузере. Aurum позаботится об остальном.":
    "Confirm sign-in in your browser. Aurum will take care of the rest.",
  "Выберите аккаунт в браузере и подтвердите вход. Aurum подключит его автоматически.":
    "Choose your account in the browser and approve sign-in. Aurum will connect it automatically.",
  "Подтвердите вход в браузере": "Confirm sign-in in your browser",
  "Хранилище с очисткой кэша и восстановлением удалённых сборок и файлов.":
    "Storage management with cache cleanup and recovery of deleted instances and files.",
  "Microsoft открывается в вашем браузере. Существующие входы сохраняются.":
    "Microsoft sign-in opens in your browser. Existing sign-ins are preserved.",
  "Компактная Java без инструментов разработчика и автоматическая очистка временных загрузок.":
    "Compact Java without developer tools and automatic temporary-download cleanup.",
  "Папки лаунчера и игры разделены, сборки и миры сохранены.":
    "Launcher and game folders are separate, with instances and worlds preserved.",
});
Object.assign(storageEnglish, {
  "Установленные версии": "Installed versions",
  "Используемые версии защищены от удаления. Ненужные можно удалить отдельно.":
    "Versions in use are protected. Unused versions can be removed individually.",
  Используется: "In use",
  "Не используется": "Not in use",
  "Удалить версию {{v1}}": "Delete version {{v1}}",
  "Удалить неиспользуемую версию?": "Delete unused version?",
});
Object.assign(storageEnglish, {
  "Удаление компонентов": "Remove components",
  "Освободите место, удалив целую категорию файлов.":
    "Free up space by removing an entire file category.",
  "Выберите категорию целиком. Отдельные сборки можно удалить в разделе «Сборки и миры».":
    "Choose an entire category. Remove individual instances under Instances and worlds.",
  "Удалить компонент {{v1}}": "Remove component {{v1}}",
  "Удалить «{{v1}}»?": "Remove “{{v1}}”?",
  "Все сборки и миры будут перемещены в корзину Aurum. Их можно восстановить. Место освободится после очистки корзины.":
    "All instances and worlds will move to the Aurum trash and can be restored. Empty the trash to reclaim disk space.",
  "Общие файлы Minecraft будут удалены. Сборки, миры, моды и настройки сохранятся. Перед игрой потребуется повторная установка.":
    "Shared Minecraft files will be removed. Instances, worlds, mods and settings will be kept. Reinstall before playing again.",
  "Файлы Horizon будут удалены. Сборки, миры, моды и настройки сохранятся. Перед игрой потребуется повторная установка.":
    "Horizon files will be removed. Instances, worlds, mods and settings will be kept. Reinstall before playing again.",
  "Будет удалена только Java из папки Aurum. Системная Java сохранится. Нужная среда запуска будет найдена или скачана перед игрой.":
    "Only Java in the Aurum folder will be removed. System Java will be kept. A compatible runtime will be found or downloaded before playing.",
  "Файлы серверов внутри Aurum и их миры будут удалены без восстановления. Импортированные папки вне Aurum сохранятся.":
    "Server files and worlds inside Aurum will be permanently deleted. Imported folders outside Aurum will be kept.",
  "Восстанавливаемый кэш будет очищен. Кэш интерфейса удалится при перезапуске. Миры, настройки и входы сохранятся.":
    "Rebuildable cache will be cleared. Interface cache will be cleared on restart. Worlds, settings and sign-ins will be kept.",
  "Будут удалены ненужные архивы установок и остатки прерванных загрузок.":
    "Unused installation archives and interrupted download files will be removed.",
  "Журналы установок будут удалены. Миры и настройки сохранятся.":
    "Installation logs will be removed. Worlds and settings will be kept.",
  "Вся корзина Aurum будет очищена без возможности восстановления файлов и миров.":
    "The entire Aurum trash will be emptied. Files and worlds cannot be restored.",
  "Файлы вне основных категорий будут удалены без возможности восстановления. Служебные метки Aurum сохранятся.":
    "Files outside the main categories will be permanently deleted. Aurum ownership markers will be kept.",
  "Открыть деинсталлятор": "Open uninstaller",
  "Сборки перемещены в корзину": "Instances moved to trash",
  "Неизвестный компонент хранилища": "Unknown storage component",
  "Удаление компонентов по категориям: игровые файлы можно установить заново, а сборки и миры восстановить из корзины.":
    "Remove components by category: reinstall game files or restore instances and worlds from the trash.",
});
export const storageRussian = Object.fromEntries(
  Object.keys(storageEnglish).map((key) => [key, key]),
);
