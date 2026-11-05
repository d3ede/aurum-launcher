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
export const storageRussian = Object.fromEntries(
  Object.keys(storageEnglish).map((key) => [key, key]),
);
